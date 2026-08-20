# Booking / Operating Split

## Booking invariants

- Physio general-treatment planning window is 60 minutes with an operational tolerance of ±5 minutes.
- Booking hard-blocks only unsafe gender/room-capacity conflicts and overlapping duplicate-patient bookings.
- General beds are not pre-assigned to patients at booking time.
- Machine modalities are expected demand only. Booking does not create machine reservations or exact machine timelines.
- Traction is treated as a machine demand with a 20-minute expected-use reminder, not as a patient bed.

## Live operating invariants

- Reception marks Arrived.
- Therapist/Owner/Manager starts and completes general treatment.
- A general bed is allocated only at actual treatment start using live gender-compatible capacity.
- Authorized Physio operating staff (Owner, Manager, Receptionist, Therapist through existing chamber permissions) may start/finish actual machine use.
- Only Traction may run while the patient is Waiting, allowing traction before general treatment.
- When Traction starts after general treatment, the general bed is released immediately.
- Actual machine use is exclusive: a physical machine cannot be started for two patients simultaneously.
- Machine timers are reminders only; Finish is explicit and auditable.
- Treatment cannot be completed while a machine is still running.

## Rollback

The implementation is isolated from the legacy fixed-bed engine. Reverting the merge commit restores the previous visible booking/operating paths without deleting legacy sheets or schema.
