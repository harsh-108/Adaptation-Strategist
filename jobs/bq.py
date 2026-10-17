"""BigQuery public datasets for the data jobs. Off unless GOOGLE_CLOUD_PROJECT is set: queries are billed to that project
(the ones here stay inside BigQuery's free 1 TB a month). Sign in with GOOGLE_APPLICATION_CREDENTIALS (a service-account
key) or `gcloud auth application-default login`. Each query is dry-run first and skipped if it would read more than
BQ_MAX_GB (default 200), so the caller falls back to its download instead of running up a bill."""
from app.settings import env


def enabled() -> bool:
    return bool(env("GOOGLE_CLOUD_PROJECT"))


def rows(sql: str, what: str, params: list | None = None):
    """The query's rows as a list, or None (not configured, too big, or failed), so the caller can fall back."""
    if not enabled():
        return None
    try:
        from google.cloud import bigquery
        client = bigquery.Client(project=env("GOOGLE_CLOUD_PROJECT"))
        cfg = dict(query_parameters=params or [])
        dry = client.query(sql, job_config=bigquery.QueryJobConfig(dry_run=True, use_query_cache=False, **cfg))
        gb, limit = dry.total_bytes_processed / 1e9, float(env("BQ_MAX_GB", "200") or 200)
        if gb > limit:
            print(f"BigQuery: {what} would read {gb:.1f} GB (limit BQ_MAX_GB={limit:g}); using the download instead.", flush=True)
            return None
        print(f"BigQuery: {what}, reading {gb:.2f} GB", flush=True)
        return list(client.query(sql, job_config=bigquery.QueryJobConfig(**cfg)).result())
    except Exception as e:  # noqa: BLE001
        print(f"BigQuery: {what} failed ({str(e)[:200]}); using the download instead.", flush=True)
        return None
