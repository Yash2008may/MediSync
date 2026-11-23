#!/usr/bin/env bash
# Smoke test. Server running on :5000 with a fresh DB (npm run db:reset) and AUTO_VERIFY_PHARMACIES=true.
API=http://localhost:5000/api
H='Content-Type: application/json'
j() { python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }

echo "--- Register patient (with consents)"
PT=$(curl -s -X POST $API/auth/patient/register -H "$H" -d '{"name":"Asha Rao","phone":"9876543210","email":"asha@example.com","address":"12 MG Road, Bengaluru","password":"Secret123","consents":{"privacyPolicy":true,"healthData":true,"notifications":true}}' | j "['token']"); echo "token ok: ${PT:0:20}..."
echo "--- Register patient WITHOUT consent (expect 400)"
curl -s -X POST $API/auth/patient/register -H "$H" -d '{"name":"X Y","phone":"9876543211","email":"x@example.com","address":"somewhere 123","password":"Secret123","consents":{"privacyPolicy":true,"healthData":false}}'; echo
echo "--- Register pharmacy"
PH=$(curl -s -X POST $API/auth/pharmacy/register -H "$H" -d '{"storeName":"LifeCare Medicals","licenseNumber":"KA-B12-492018","email":"life@example.com","phone":"9123456780","address":"5 Indiranagar, Bengaluru","password":"Store1234","latitude":12.9784,"longitude":77.6408,"pharmacistName":"R. Nair","pharmacistRegNo":"KSPC-12345","consents":{"privacyPolicy":true}}' | j "['token']"); echo "token ok: ${PH:0:20}..."
echo "--- Location without consent (expect 403)"
curl -s -X PUT $API/patients/me/location -H "$H" -H "Authorization: Bearer $PT" -d '{"latitude":12.97,"longitude":77.64,"altitude":null,"accuracy":20}'; echo
echo "--- Grant location consent, then send live GPS"
curl -s -X POST $API/me/consents -H "$H" -H "Authorization: Bearer $PT" -d '{"type":"location","granted":true}' >/dev/null
curl -s -X PUT $API/patients/me/location -H "$H" -H "Authorization: Bearer $PT" -d '{"latitude":12.97,"longitude":77.64,"altitude":null,"accuracy":20}'; echo
echo "--- Nearby stores"; curl -s "$API/stores/nearby?lat=12.97&lng=77.64" -H "Authorization: Bearer $PT"; echo
echo "--- Upload prescription (needs ./rx.jpg and the pharmacy id from /auth/pharmacy/login)"
echo "--- Forgot password (OTP is printed in the server console)"
curl -s -X POST $API/auth/forgot-password -H "$H" -d '{"role":"patient","identifier":"asha@example.com"}'; echo
