# Google Sheets schedule setup

The Google Sheets schedule adapter reads a clinic schedule from `core.clinic_integrations.config`. The adapter is configuration-driven: enabled days, doctor metadata, and admin-confirmation policy must come from the integration record rather than from hardcoded adapter rules.

## MVP schedule-day config

For the current MVP, configure the clinic's active Google Sheets schedule integration to expose only Monday and Saturday availability. Both days should use the same default doctor metadata.

```json
{
  "timeColumn": "B",
  "dateHeaderRow": 1,
  "firstTimeRow": 2,
  "timezone": "America/New_York",
  "slotMinutes": 15,
  "sheetName": "Schedule",
  "enabledScheduleDays": ["monday", "saturday"],
  "defaultDoctorId": "dr_primary",
  "adminConfirmationRequired": true
}
```

## Config fields

- `timeColumn`: the spreadsheet column containing appointment times.
- `dateHeaderRow`: the 1-based row number containing date headers.
- `firstTimeRow`: the 1-based row number where appointment times begin.
- `timezone`: the IANA timezone used to interpret sheet dates and times.
- `slotMinutes`: the duration of each grid slot.
- `sheetName`: optional sheet name copied into slot metadata.
- `enabledScheduleDays`: lowercase weekday names that the adapter may expose. Disabled weekdays are ignored even when the spreadsheet has open cells for those days.
- `defaultDoctorId`: doctor identifier attached to every returned slot as `metadata.doctor_id`.
- `adminConfirmationRequired`: confirmation policy attached to every returned slot as `metadata.admin_confirmation_required`.

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
