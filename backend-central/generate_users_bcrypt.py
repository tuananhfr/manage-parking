"""
Generate user password hashes using bcrypt directly (compatible with bcrypt 5.x)
"""
import bcrypt
import json
import os

# Generate hashes
admin_password = "admin123"
guard_password = "guard123"

admin_hash = bcrypt.hashpw(admin_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
guard_hash = bcrypt.hashpw(guard_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

print(f"admin123: {admin_hash}")
print(f"guard123: {guard_hash}")

# Verify they work
print(f"\nVerifying admin: {bcrypt.checkpw(admin_password.encode('utf-8'), admin_hash.encode('utf-8'))}")
print(f"Verifying guard: {bcrypt.checkpw(guard_password.encode('utf-8'), guard_hash.encode('utf-8'))}")

# Write to users.json
users_data = {
    "users": [
        {
            "id": 1,
            "username": "admin",
            "password_hash": admin_hash,
            "full_name": "Quản lý",
            "role": "manager"
        },
        {
            "id": 2,
            "username": "guard",
            "password_hash": guard_hash,
            "full_name": "Bảo vệ",
            "role": "guard"
        }
    ],
    "external_url": ""
}

users_file = os.path.join("data", "users.json")
with open(users_file, 'w', encoding='utf-8') as f:
    json.dump(users_data, f, indent=2, ensure_ascii=False)

print(f"\nUpdated {users_file}")
