# Google Sheets schedule setup

The Google Sheets schedule adapter reads and writes a clinic schedule from the clinic's active `core.clinic_integrations.config` record. The adapter is configuration-driven: enabled days, doctor metadata, Google Sheets identifiers, and admin-confirmation policy must come from the integration record rather than hardcoded adapter rules.

Postgres remains the source of truth for appointment lifecycle state. Google Sheets stores only minimal appointment display data written by the backend `ScheduleAdapter`; AI and n8n workflows must never write directly to Google Sheets.

## Service account setup

1. In Google Cloud, create or select the project that owns the Google Sheets API integration.
2. Enable the **Google Sheets API** for the project.
3. Create a service account for the backend schedule adapter.
4. Create a JSON key for that service account and store it in your secret manager or deployment environment.
5. Copy the service account email from the JSON key's `client_email` field.
6. Open the clinic schedule spreadsheet in Google Sheets and share it with that service account email. Grant edit access if appointment confirmation should write to cells.

## Environment variable

Set the service account JSON as an environment variable for the backend process:

```bash
GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"...","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n","client_email":"schedule-writer@example-project.iam.gserviceaccount.com","client_id":"..."}'
```

You may use a different variable name by setting `serviceAccountJsonEnvVar` in `clinic_integrations.config`.

> **Security warning:** never commit service account JSON, private keys, `.env` files containing credentials, or copied key material to git.

## MVP schedule-day config

For the current MVP, configure the clinic's active Google Sheets schedule integration to expose only Monday and Saturday availability. Both days should use the same default doctor metadata.

The current clinic sheet is a human schedule tab named `Графік`. It keeps time values in column `B`, weekday labels in row 2, actual date headers in row 3, and the first time row at row 4. The adapter reads the actual date row and ignores colors/formatting as an availability source of truth.

```json
{
  "timeColumn": "B",
  "dateHeaderRow": 3,
  "firstTimeRow": 4,
  "timezone": "Europe/Kyiv",
  "slotMinutes": 15,
  "sheetName": "Графік",
  "spreadsheetId": "1abcDEFghiJKLmnoPQRstuVWxyz1234567890",
  "readRange": "A1:AP200",
  "writeMode": "cell",
  "serviceAccountJsonEnvVar": "GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON",
  "enabledScheduleDays": ["monday", "saturday"],
  "defaultDoctorId": "dr_primary",
  "adminConfirmationRequired": true
}
```

## Config fields

- `timeColumn`: the spreadsheet column containing appointment times.
- `dateHeaderRow`: the 1-based row number containing actual date headers. The clinic sheet uses row 3 with `DD.MM.YYYY` values such as `04.10.2025`.
- `firstTimeRow`: the 1-based row number where appointment times begin. The clinic sheet uses row 4 with dot-format times such as `07.00`, `07.15`, and `10.45`.
- `timezone`: the IANA timezone used to interpret sheet dates and times.
- `slotMinutes`: the duration of each grid slot. Availability requests can ask for longer `durationMinutes`; the adapter only returns starts with enough consecutive empty cells in the same date column.
- `sheetName`: sheet tab name used for reads, slot metadata, and write ranges.
- `spreadsheetId`: Google Sheets spreadsheet ID from the spreadsheet URL.
- `readRange`: A1 range read by availability checks, for example `A1:AP200`.
- `writeMode`: `cell` writes the selected slot cell. `append` is supported for integrations that intentionally append through the Sheets API, but the MVP should use `cell`.
- `serviceAccountJsonEnvVar`: optional environment variable name containing the service account JSON. Defaults to `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON`.
- `enabledScheduleDays`: lowercase weekday names that the adapter may expose. Disabled weekdays are ignored even when the spreadsheet has open cells for those days.
- `defaultDoctorId`: doctor identifier attached to every returned slot as `metadata.doctor_id`.
- `adminConfirmationRequired`: confirmation policy attached to every returned slot as `metadata.admin_confirmation_required`.

## Availability truth

The adapter treats an empty appointment cell as potentially available and any non-empty appointment cell as occupied. It does not use cell colors or formatting as availability truth.

## Write behavior

When `/appointments/confirm` confirms a held appointment, the backend schedule adapter writes only minimal display text to the selected sheet cell:

```text
patientName | service | AI pending
```

The adapter must not write raw messages, conversation history, trace data, LLM confidence, `state_json`, or full case data to Google Sheets.

On success, the adapter returns a stable external reference in this format:

```text
spreadsheetId:sheetName:cellRange
```

## Read behavior and tests

In production, availability reads come from `spreadsheetId`, `sheetName`, and `readRange`. Tests may still pass `providerMetadata.grid`; when present, the adapter uses that grid instead of calling Google Sheets.

If Google Sheets credentials or new Google config fields are missing, the adapter falls back to the existing read-only behavior and uses the configured in-memory grid when available. Write attempts return `ok: false` with a structured reason instead of exposing raw Google API errors to HTTP routes.

## Disabled-day behavior

When a request range includes both enabled and disabled weekdays, the adapter returns only slots from enabled weekdays. For example, with `enabledScheduleDays` set to `["monday", "saturday"]`, Tuesday columns are ignored.

When a request range targets only disabled weekdays represented in the sheet, the adapter returns no slots and includes a `requested_day_not_enabled` warning so the caller can explain that the requested weekday is not available for online scheduling.

## Enabling another day

To expose another weekday, add it to `enabledScheduleDays` in the active `clinic_integrations.config` record. For example, adding Tuesday makes Tuesday sheet columns eligible without changing adapter code:

```json
{
  "enabledScheduleDays": ["monday", "tuesday", "saturday"]
}
```
