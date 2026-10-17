"""Check the Google Cloud setup for the Earth Engine and BigQuery data jobs:

    python -m jobs.check_gcp

Needs, in .env or the environment:
    GOOGLE_CLOUD_PROJECT=your-project-id          (the project with Earth Engine and BigQuery enabled)
    GOOGLE_APPLICATION_CREDENTIALS=/path/key.json (a service-account key; keep it out of the app folder you deploy)
It signs in, then confirms each dataset the plan uses can be read. Nothing is written or billed beyond a few tiny
metadata reads (BigQuery's dry run reports bytes without running the query)."""
import sys

from app.settings import env

# Earth Engine datasets in the plan (from the data plan you supplied, plus wildfire). A "not found" here means the id
# needs correcting before the job that uses it is written.
EE_DATASETS = [
    ("NASA/GDDP-CMIP6", "image_collection", "Heat and rainfall projections (NEX-GDDP-CMIP6)"),
    ("ECMWF/ERA5_LAND/DAILY_AGGR", "image_collection", "Today's heat and free-cooling hours (ERA5-Land)"),
    ("MODIS/061/MOD11A2", "image_collection", "Land surface temperature (MODIS)"),
    ("WRI/Aqueduct_Water_Risk/V4/baseline_annual", "table", "Water stress today (Aqueduct 4.0)"),
    ("WRI/Aqueduct_Water_Risk/V4/future_annual", "table", "Water stress projections (Aqueduct 4.0)"),
    ("JRC/GSW1_4/GlobalSurfaceWater", "image", "Flood exposure (JRC Global Surface Water)"),
    ("GLOBAL_FLOOD_DB/MODIS_EVENTS/V1", "image_collection", "Observed floods (Global Flood Database)"),
    ("NASA/GRACE/MASS_GRIDS_V04/LAND", "image_collection", "Groundwater trend (GRACE)"),
    ("WRI/GPPD/power_plants", "table", "Power plants near sites (Global Power Plant Database)"),
    ("JRC/GHSL/P2023A/GHS_POP", "image_collection", "Population (GHSL)"),
    ("GOOGLE/DYNAMICWORLD/V1", "image_collection", "Land cover (Dynamic World)"),
    ("FIRMS", "image_collection", "Active fires (NASA FIRMS)"),
    ("MODIS/061/MCD64A1", "image_collection", "Burned area (MODIS)"),
]
BQ_TABLES = [("bigquery-public-data.noaa_gsod.gsod2024", "stn, temp", "Historic station temperatures (NOAA GSOD)"),
             ("bigquery-public-data.noaa_hurricanes.hurricanes", "sid, season, latitude, longitude, usa_wind", "Cyclone tracks (IBTrACS)"),
             ("bigquery-public-data.geo_openstreetmap.planet_features", "osm_id, all_tags", "OpenStreetMap features (data centres)"),
             ("bigquery-public-data.overture_maps.division_area", "country, subtype", "Country boundaries (Overture Maps)")]


def main() -> int:
    project = env("GOOGLE_CLOUD_PROJECT")
    creds_path = env("GOOGLE_APPLICATION_CREDENTIALS")
    if not project or not creds_path:
        print("Not configured yet. Add GOOGLE_CLOUD_PROJECT and GOOGLE_APPLICATION_CREDENTIALS (path to a service-account key) to .env.")
        return 2
    ok = True

    print(f"Earth Engine (project {project})")
    try:
        import ee
        from google.oauth2 import service_account
        creds = service_account.Credentials.from_service_account_file(creds_path, scopes=["https://www.googleapis.com/auth/earthengine",
                                                                                         "https://www.googleapis.com/auth/cloud-platform"])
        ee.Initialize(credentials=creds, project=project)
        print("  signed in")
        for asset_id, _, what in EE_DATASETS:
            try:
                info = ee.data.getAsset(asset_id)
                print(f"  ok        {asset_id}  ({what}; {info.get('type', '?').lower()})")
            except Exception as e:  # noqa: BLE001
                ok = False
                print(f"  NOT FOUND {asset_id}  ({what}): {str(e)[:120]}")
    except Exception as e:  # noqa: BLE001
        ok = False
        print(f"  could not sign in: {str(e)[:300]}")
        print("  Check the key, that the Earth Engine API is enabled, and that the project is registered for Earth Engine.")

    print(f"BigQuery (project {project})")
    try:
        from google.cloud import bigquery
        client = bigquery.Client(project=project)
        for table, cols, what in BQ_TABLES:
            try:
                job = client.query(f"SELECT {cols} FROM `{table}` LIMIT 1", job_config=bigquery.QueryJobConfig(dry_run=True, use_query_cache=False))
                print(f"  ok        {table}  ({what}; a full scan would read {job.total_bytes_processed / 1e6:.0f} MB)")
            except Exception as e:  # noqa: BLE001
                ok = False
                print(f"  NOT FOUND {table}  ({what}): {str(e)[:160]}")
    except Exception as e:  # noqa: BLE001
        ok = False
        print(f"  BigQuery check failed: {str(e)[:300]}")
        print("  Check that the BigQuery API is enabled and the service account has the BigQuery Job User role.")

    print("\nAll good." if ok else "\nSome checks failed; see above.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
