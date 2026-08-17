insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'relife-patient-reports',
  'relife-patient-reports',
  false,
  12582912,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
