-- FootSmart admin bootstrap user
-- Password used before hashing: admin1234
-- Hash generated with bcrypt(10)

INSERT INTO users (
  email,
  password_hash,
  display_name,
  role,
  account_status,
  is_18_plus,
  points,
  balance,
  kyc_status
)
VALUES (
  'admin@admin.com',
  '$2b$10$4A55Okz0gvpk9Ye/DU5eYum5MxM77M9GfZMMf8z9BeXgJLOJ4NfXy',
  'Admin',
  'admin',
  'active',
  true,
  100000,
  0,
  'approved'
)
ON CONFLICT (email)
DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  role = 'admin',
  account_status = 'active',
  is_18_plus = true,
  points = GREATEST(users.points, 100000),
  kyc_status = 'approved';
