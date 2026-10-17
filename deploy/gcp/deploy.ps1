# Deploy the Adaptation Strategist to Google Cloud: Cloud Run + Vertex AI Gemini + Firestore + Firebase Hosting + Secret Manager
# + Cloud Storage + Cloud Scheduler (+ Google Analytics when GA_MEASUREMENT_ID is in .env).
# Run from the project folder in PowerShell after `gcloud auth login`:
#   powershell -ExecutionPolicy Bypass -File deploy\gcp\deploy.ps1 -Project YOUR_PROJECT_ID
# Safe to run again: existing secrets, bucket, service account and job are reused or updated.
param(
  [Parameter(Mandatory = $true)][string]$Project,
  [string]$Region = "asia-south1",
  [string]$Service = "atlas-web",
  [string]$Bucket = "",
  [switch]$Private,         # no public link; put Identity-Aware Proxy in front from the Cloud Run console
  [switch]$UnlockHubs       # allow hub and news-feed edits on the deployed app (locked by default on the public demo)
)
# "Continue", not "Stop": Windows PowerShell treats gcloud's normal stderr output as an error under "Stop".
# Each step checks gcloud's exit code instead.
$ErrorActionPreference = "Continue"
if (-not $Bucket) { $Bucket = "$Project-atlas" }
$Sa = "atlas-run@$Project.iam.gserviceaccount.com"
function Run([string]$what, [scriptblock]$cmd) { Write-Host "-> $what"; & $cmd; if ($LASTEXITCODE -ne 0) { throw "Failed: $what" } }

Run "Select project" { gcloud config set project $Project --quiet }
Run "Enable APIs" { gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com aiplatform.googleapis.com storage.googleapis.com cloudscheduler.googleapis.com firestore.googleapis.com firebase.googleapis.com firebasehosting.googleapis.com weather.googleapis.com airquality.googleapis.com geocoding-backend.googleapis.com sheets.googleapis.com docs.googleapis.com maps-backend.googleapis.com --quiet }

# Service account the app runs as: Vertex AI, its secrets and its bucket only.
gcloud iam service-accounts describe $Sa *> $null
if ($LASTEXITCODE -ne 0) { Run "Create service account" { gcloud iam service-accounts create atlas-run --display-name "Adaptation Strategist" --quiet } }
Run "Allow Vertex AI" { gcloud projects add-iam-policy-binding $Project --member "serviceAccount:$Sa" --role roles/aiplatform.user --condition None --quiet *> $null }

# Bucket for the team's records (Cloud Run's own disk is wiped at each deploy).
gcloud storage buckets describe "gs://$Bucket" *> $null
if ($LASTEXITCODE -ne 0) { Run "Create bucket" { gcloud storage buckets create "gs://$Bucket" --location $Region --uniform-bucket-level-access --quiet } }
Run "Allow bucket access" { gcloud storage buckets add-iam-policy-binding "gs://$Bucket" --member "serviceAccount:$Sa" --role roles/storage.objectAdmin --quiet *> $null }
# The deployed app starts with a clean database: local records (and any old sign-in accounts in them) stay on this PC.

# Firestore (Native mode, same region) for approvals, the audit trail, meter summaries and assumptions.
gcloud firestore databases describe --database="(default)" *> $null
if ($LASTEXITCODE -ne 0) { Run "Create Firestore database" { gcloud firestore databases create --database="(default)" --location=$Region --type=firestore-native --quiet } }
Run "Allow Firestore" { gcloud projects add-iam-policy-binding $Project --member "serviceAccount:$Sa" --role roles/datastore.user --condition None --quiet *> $null }

# Secrets: copy the keys that are set in .env into Secret Manager. Gemini runs on Vertex AI, so its API key isn't needed.
$envVals = @{}
if (Test-Path ".env") {
  foreach ($line in Get-Content ".env") {
    if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') { $envVals[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'") }
  }
}
if (-not $envVals["TASK_TOKEN"]) { $envVals["TASK_TOKEN"] = [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N") }
$secretNames = @("GOOGLE_MAPS_API_KEY", "GROQ_API_KEY", "OPENAQ_API_KEY", "ELECTRICITYMAPS_API_KEY", "EIA_API_KEY", "EMBER_API_KEY", "TASK_TOKEN")
$secretArgs = @()
foreach ($k in $secretNames) {
  $v = $envVals[$k]
  if (-not $v) { continue }
  $name = "atlas-" + $k.ToLower().Replace("_", "-")
  $tmp = New-TemporaryFile
  [IO.File]::WriteAllText($tmp.FullName, $v)          # no trailing newline in the secret
  gcloud secrets describe $name *> $null
  if ($LASTEXITCODE -ne 0) { Run "Create secret $name" { gcloud secrets create $name --data-file $tmp.FullName --quiet } }
  else { Run "Update secret $name" { gcloud secrets versions add $name --data-file $tmp.FullName --quiet } }
  Remove-Item $tmp.FullName -Force
  Run "Allow app to read $name" { gcloud secrets add-iam-policy-binding $name --member "serviceAccount:$Sa" --role roles/secretmanager.secretAccessor --quiet *> $null }
  $secretArgs += "$k=${name}:latest"
}

# "^##^" makes ## the separator, because model lists contain commas.
$lock = if ($UnlockHubs) { "0" } else { "1" }
$envArgs = "^##^GOOGLE_GENAI_USE_VERTEXAI=true##GOOGLE_CLOUD_PROJECT=$Project##GOOGLE_CLOUD_LOCATION=global##GCS_BUCKET=$Bucket" +
           "##FIRESTORE=on##DEMO_LOCK_HUBS=$lock##ALLOWED_ORIGINS=https://$Project.web.app,https://$Project.firebaseapp.com"
foreach ($k in @("GEMINI_MODEL", "GROQ_MODEL", "RELIEFWEB_APPNAME", "ALERT_MINUTES", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_MAPS_BROWSER_KEY", "GA_MEASUREMENT_ID")) { if ($envVals[$k]) { $envArgs += "##$k=$($envVals[$k])" } }
$access = if ($Private) { "--no-allow-unauthenticated" } else { "--allow-unauthenticated" }

# At most one instance: sites and alerts live in one SQLite file, so there must be one writer. Zero when idle (no cost).
# --no-cpu-throttling keeps the CPU on while an instance is up, so a site's data build and the copy to the bucket finish
# after the request that started them; --cpu-boost shortens cold starts.
Run "Deploy to Cloud Run (builds from source, takes a few minutes)" {
  gcloud run deploy $Service --source . --region $Region --service-account $Sa $access `
    --min-instances 0 --max-instances 1 --memory 1Gi --cpu 1 --timeout 300 --cpu-boost --no-cpu-throttling `
    --set-env-vars $envArgs --set-secrets ($secretArgs -join ",") --quiet
}
$Url = (gcloud run services describe $Service --region $Region --format "value(status.url)").Trim()

# Cloud Scheduler: run the alert check every 30 minutes (Cloud Run may have paused the in-app loop).
$jobArgs = @("--location", $Region, "--schedule", "*/30 * * * *", "--uri", "$Url/tasks/alerts", "--http-method", "POST",
             "--oidc-service-account-email", $Sa, "--oidc-token-audience", $Url, "--quiet")
gcloud scheduler jobs describe atlas-alerts --location $Region *> $null
if ($LASTEXITCODE -ne 0) { Run "Create alert schedule" { gcloud scheduler jobs create http atlas-alerts @jobArgs --headers "X-Task-Token=$($envVals['TASK_TOKEN'])" } }
else { Run "Update alert schedule" { gcloud scheduler jobs update http atlas-alerts @jobArgs --update-headers "X-Task-Token=$($envVals['TASK_TOKEN'])" } }
if ($Private) { Run "Let Scheduler call the private service" { gcloud run services add-iam-policy-binding $Service --region $Region --member "serviceAccount:$Sa" --role roles/run.invoker --quiet *> $null } }

# Firebase Hosting in front of Cloud Run (https://PROJECT.web.app) and the Firestore rules that shut out browsers.
$WebApp = ""
if (Get-Command firebase -ErrorAction SilentlyContinue) {
  firebase projects:addfirebase $Project *> $null      # adds Firebase to this project; harmless if it is already there
  $fj = (Get-Content "firebase.json" -Raw) -replace '"serviceId": "[^"]*"', ('"serviceId": "' + $Service + '"') -replace '"region": "[^"]*"', ('"region": "' + $Region + '"')
  [IO.File]::WriteAllText((Join-Path (Get-Location) "firebase.json"), $fj)    # UTF-8 without a BOM
  Run "Deploy Firebase Hosting and Firestore rules" { firebase deploy --only "hosting,firestore:rules" --project $Project --non-interactive }
  $WebApp = "https://$Project.web.app"
} else {
  Write-Host "Firebase CLI not found, so the web.app address was skipped. Install it (npm install -g firebase-tools), run firebase login, then run this script again."
}

Write-Host ""
if ($WebApp) { Write-Host "Done: $WebApp  (Firebase Hosting)  and  $Url  (Cloud Run)" } else { Write-Host "Done: $Url" }
Write-Host "Check what is connected: $Url/api/health  (look for the google block)"
