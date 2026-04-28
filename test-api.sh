#!/bin/bash
TOKEN=$(cat "$HOME/Library/Application Support/se.qte.timetracker/auth.json" | python3 -c "import json,sys; print(json.load(sys.stdin)['authState']['accessToken'])")
echo "Token length: ${#TOKEN}"
echo ""
echo "=== Today's entries (per-employee) ==="
curl -s "https://qvik.agileday.io/api/v1/time_entry/employee/id/22f8610d-ecb5-49a5-9933-43f4312f8c0c?startDate=2026-04-28&endDate=2026-04-28" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Origin: https://qvik.agileday.io" | python3 -m json.tool
echo ""
echo "=== Today's entries (global) ==="
curl -s "https://qvik.agileday.io/api/v1/time_entry?startDate=2026-04-28&endDate=2026-04-28" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Origin: https://qvik.agileday.io" | python3 -c "
import json, sys
data = json.load(sys.stdin)
mine = [e for e in data if e.get('employeeId') == '22f8610d-ecb5-49a5-9933-43f4312f8c0c']
print(f'Total: {len(data)}, mine: {len(mine)}')
for e in mine:
    print(f'  {e[\"date\"]} | {e.get(\"description\",\"?\"):20s} | {e[\"minutes\"]}min | {e[\"status\"]}')
"
