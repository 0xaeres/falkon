#!/usr/bin/env bash
# Bring up the parity stack and write parity/.gen/keys.env with the v6 API key the runner uses.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .gen
./fetch-corpus.sh
node gen-configs.mjs
docker compose up -d --build

echo "waiting for v6 to migrate and create its org..."
for _ in $(seq 1 120); do
  if docker compose exec -T v6-postgres psql -U sb -d sb -tAc 'select 1 from "Org" where id=1' 2>/dev/null | grep -q 1; then break; fi
  sleep 2
done

# v6 has no anonymous access, so seed an owner + API key straight into its DB.
# Key format and hashing mirror v6: "sbk_" + secret, stored as HMAC-SHA256(SOURCEBOT_ENCRYPTION_KEY, secret).
ENC=${PARITY_ENCRYPTION_KEY:-parity-encryption-key-32-bytes!!}
SECRET=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')
HASH=$(node -e 'console.log(require("crypto").createHmac("sha256",process.argv[1]).update(process.argv[2]).digest("hex"))' "$ENC" "$SECRET")
docker compose exec -T v6-postgres psql -U sb -d sb -v ON_ERROR_STOP=1 <<SQL >/dev/null
insert into "User"(id, email, name, "createdAt", "updatedAt") values ('parity', 'parity@example.test', 'parity', now(), now()) on conflict do nothing;
insert into "UserToOrg"("orgId", "userId", role) values (1, 'parity', 'OWNER') on conflict do nothing;
update "Org" set "isOnboarded" = true where id = 1;
delete from "ApiKey" where name = 'parity';
insert into "ApiKey"(name, hash, "orgId", "createdById") values ('parity', '$HASH', 1, 'parity');
SQL
# Test-only owner password so you can sign in and complete v6's one-time registration.
PW=$(node -e 'console.log(require("crypto").randomBytes(9).toString("base64url"))')
BC=$(mktemp -d)
(cd "$BC" && npm i --silent bcryptjs@2.4.3 >/dev/null 2>&1)
PWHASH=$(NODE_PATH="$BC/node_modules" node -e 'console.log(require("bcryptjs").hashSync(process.argv[1], 10))' "$PW")
rm -rf "$BC"
docker compose exec -T v6-postgres psql -U sb -d sb -c "update \"User\" set \"hashedPassword\" = '$PWHASH' where id = 'parity'" >/dev/null
mkdir -p .gen
printf 'V6_API_KEY=sbk_%s\nV6_OWNER_EMAIL=parity@example.test\nV6_OWNER_PASSWORD=%s\n' "$SECRET" "$PW" > .gen/keys.env
echo "If v6 answers DEPLOYMENT_RESTRICTED: sign in at http://localhost:3100 with the owner in .gen/keys.env and register."
echo "v6: http://localhost:3100  clone: http://localhost:3200  (key in parity/.gen/keys.env)"
