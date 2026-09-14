# Missing service-time resolution

General Process calibration no longer assumes that an activity with no valid duration observations is a terminal activity.

Such activities are marked `unresolved` and must be resolved in the UI before baseline simulation or optimization can run. The user can:

1. Confirm **Terminal / milestone** (instantaneous, no resource/service time).
2. Enter a **triangular distribution** using minimum, most-likely, and maximum minutes.
3. **Copy the service-time distribution from a similar resolved activity**.

A last activity in observed cases is shown as a terminal suggestion only; it is not auto-classified.
