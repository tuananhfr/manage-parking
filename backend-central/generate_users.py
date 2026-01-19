from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

admin_hash = pwd_context.hash("admin123")
guard_hash = pwd_context.hash("guard123")

print(f"admin123: {admin_hash}")
print(f"guard123: {guard_hash}")

# Also write to users.json
import json
import os

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
