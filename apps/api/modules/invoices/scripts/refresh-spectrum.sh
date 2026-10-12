#!/bin/bash
# Spectrum Data Refresh — pulls latest vendors + jobs from Spectrum APIs
# Vendors: REST (GET), Jobs: SOAP (POST)
# Runs daily at 6 AM EST via cron

# Resolve the pipeline root (parent of this script's directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIPELINE_ROOT="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "${PIPELINE_ROOT}/../.." && pwd)"
INVOICE_DIR="${PIPELINE_ROOT}/data"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

mkdir -p "$INVOICE_DIR"

# Load repository .env if available while preserving explicitly exported Spectrum settings.
existing_spectrum_rest_url="${SPECTRUM_REST_URL+x}"
existing_spectrum_rest_user="${SPECTRUM_REST_USER+x}"
existing_spectrum_rest_pass="${SPECTRUM_REST_PASS+x}"
preserved_spectrum_rest_url="${SPECTRUM_REST_URL:-}"
preserved_spectrum_rest_user="${SPECTRUM_REST_USER:-}"
preserved_spectrum_rest_pass="${SPECTRUM_REST_PASS:-}"

if [ -f "${REPO_ROOT}/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  source "${REPO_ROOT}/.env"
  set +a
fi

[ -z "$existing_spectrum_rest_url" ] || SPECTRUM_REST_URL="$preserved_spectrum_rest_url"
[ -z "$existing_spectrum_rest_user" ] || SPECTRUM_REST_USER="$preserved_spectrum_rest_user"
[ -z "$existing_spectrum_rest_pass" ] || SPECTRUM_REST_PASS="$preserved_spectrum_rest_pass"

# Spectrum REST settings. The URL is not secret; credentials must be supplied by environment.
SPECTRUM_REST_URL="${SPECTRUM_REST_URL:-https://your-tenant.dexterchaney.example:8482}"
missing_spectrum_vars=()
[ -n "${SPECTRUM_REST_USER:-}" ] || missing_spectrum_vars+=("SPECTRUM_REST_USER")
[ -n "${SPECTRUM_REST_PASS:-}" ] || missing_spectrum_vars+=("SPECTRUM_REST_PASS")
if [ ${#missing_spectrum_vars[@]} -gt 0 ]; then
  printf 'Missing required Spectrum REST credential environment variable(s): %s\n' "${missing_spectrum_vars[*]}" >&2
  exit 1
fi

echo "[$TIMESTAMP] Refreshing Spectrum data..."

# --- Vendors (REST) ---
VENDOR_FILE="$INVOICE_DIR/spectrum_vendors.json"
HTTP_CODE=$(curl -s -o "$VENDOR_FILE.tmp" -w "%{http_code}" -u "${SPECTRUM_REST_USER}:${SPECTRUM_REST_PASS}" "${SPECTRUM_REST_URL}/vendors/${SPECTRUM_REST_USER}")

if [ "$HTTP_CODE" = "200" ]; then
  VENDOR_COUNT=$(python3 -c "import json; print(len(json.load(open('$VENDOR_FILE.tmp'))))" 2>/dev/null)
  mv "$VENDOR_FILE.tmp" "$VENDOR_FILE"
  echo "  Vendors: $VENDOR_COUNT records refreshed"
else
  rm -f "$VENDOR_FILE.tmp"
  echo "  Vendors: FAILED (HTTP $HTTP_CODE)"
fi

# --- Jobs (SOAP) ---
JOB_FILE="$INVOICE_DIR/spectrum_jobs_rest.json"
SOAP_RESPONSE=$(curl -s -X POST "${SPECTRUM_REST_URL}/ws/GetJob" \
  -H 'Content-Type: text/xml; charset=utf-8' \
  -H "SOAPAction: ${SPECTRUM_REST_URL}/wsdls/GetJob" \
  -d '<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:typ="http://www.northgate-is.com/proiv/webservices/types">
  <soapenv:Header/>
  <soapenv:Body>
    <typ:GetJob>
      <Authorization_ID>'"${SPECTRUM_REST_PASS}"'</Authorization_ID>
      <GUID></GUID>
      <pCompany_Code>NCG</pCompany_Code>
      <pDivision></pDivision>
      <pStatus_Code></pStatus_Code>
      <pProject_Manager></pProject_Manager>
      <pSuperintendent></pSuperintendent>
      <pEstimator></pEstimator>
      <pCustomer_Code></pCustomer_Code>
      <pCost_Center></pCost_Center>
      <pSort_By></pSort_By>
    </typ:GetJob>
  </soapenv:Body>
</soapenv:Envelope>' 2>&1)

if echo "$SOAP_RESPONSE" | grep -q "Job_Number"; then
  echo "$SOAP_RESPONSE" | python3 -c "
import sys, re, json
data = sys.stdin.read()
fields = ['Company_Code','Job_Number','Job_Description','Division','Address_1','Address_2','City','State','Zip_Code','Project_Manager','Superintendent','Estimator','Certified_Flag','Customer_Code','Status_Code','Work_State_Tax_Code','Contract_Number','Cost_Center']
blocks = re.findall(r'<response>(.*?)</response>', data, re.DOTALL)
jobs = []
for block in blocks:
    job = {}
    for f in fields:
        m = re.search(rf'<{f}>(.*?)</{f}>', block)
        job[f] = m.group(1).strip() if m else ''
    jobs.append(job)
with open('$JOB_FILE', 'w') as f:
    json.dump(jobs, f, indent=2)
active = sum(1 for j in jobs if j['Status_Code'] == 'A')
print(f'  Jobs: {len(jobs)} total ({active} active) refreshed')
with open('/tmp/job_count.txt','w') as fc: fc.write(str(len(jobs)))
"
  JOB_COUNT=$(cat /tmp/job_count.txt 2>/dev/null || echo "0")

  # Merge in any jobs from the legacy file that SOAP missed
  LEGACY_FILE="$INVOICE_DIR/spectrum_jobs.json"
  if [ -f "$LEGACY_FILE" ]; then
    python3 -c "
import json
rest = json.load(open('$JOB_FILE'))
legacy = json.load(open('$LEGACY_FILE'))
rest_nums = {j.get('Job_Number','') for j in rest}
added = 0
for j in legacy:
    if j.get('Job_Number','') and j['Job_Number'] not in rest_nums:
        rest.append(j)
        added += 1
if added:
    with open('$JOB_FILE', 'w') as f:
        json.dump(rest, f, indent=2)
    print(f'  Jobs: merged {added} missing from legacy file (total: {len(rest)})')
"
  fi
else
  echo "  Jobs: FAILED — no data in SOAP response"
fi

# --- Subcontracts (SQL) ---
cd "${PIPELINE_ROOT}"
SC_OUTPUT=$(node "${SCRIPT_DIR}/refresh-subcontracts.js" 2>&1)
if echo "$SC_OUTPUT" | grep -q "subcontracts saved"; then
  echo "  Subcontracts: $SC_OUTPUT"
else
  echo "  Subcontracts: FAILED — $SC_OUTPUT"
fi

# Extract subcontract count from output
SC_COUNT=$(echo "$SC_OUTPUT" | grep -oP '\d+(?= subcontracts saved)' || echo "0")

# --- Phase Codes (SQL) ---
cd "${PIPELINE_ROOT}"
PC_OUTPUT=$(node "${SCRIPT_DIR}/refresh-phase-codes.js" 2>&1)
if echo "$PC_OUTPUT" | grep -q "codes refreshed"; then
  echo "  $PC_OUTPUT"
  PC_COUNT=$(echo "$PC_OUTPUT" | grep -oP '\d+(?= codes refreshed)' || echo "0")
else
  echo "  Phase codes: FAILED — $PC_OUTPUT"
  PC_COUNT=0
fi

# --- GL Accounts (SQL) ---
cd "${PIPELINE_ROOT}"
GL_OUTPUT=$(node "${SCRIPT_DIR}/refresh-gl-accounts.js" 2>&1)
if echo "$GL_OUTPUT" | grep -q "accounts saved"; then
  echo "  GL Accounts: $GL_OUTPUT"
  GL_COUNT=$(echo "$GL_OUTPUT" | grep -oP '\d+(?= accounts saved)' || echo "0")
else
  echo "  GL Accounts: FAILED — $GL_OUTPUT"
  GL_COUNT=0
fi

# --- Routing Codes (SQL) ---
cd "${PIPELINE_ROOT}"
RC_OUTPUT=$(node "${SCRIPT_DIR}/refresh-routing-codes.js" 2>&1)
if echo "$RC_OUTPUT" | grep -q "codes,"; then
  echo "  $RC_OUTPUT"
  RC_CODES=$(echo "$RC_OUTPUT" | grep -oP '(?<=: )\d+(?= codes)' || echo "0")
  RC_APPROVERS=$(echo "$RC_OUTPUT" | grep -oP '\d+(?= approvers)' || echo "0")
else
  echo "  Routing codes: FAILED — $RC_OUTPUT"
  RC_CODES=0
  RC_APPROVERS=0
fi

# Write status file for API endpoint
STATUS_FILE="${INVOICE_DIR}/spectrum-refresh-status.json"
python3 -c "
import json
status = {
    'running': False,
    'lastRefresh': '$TIMESTAMP',
    'lastResult': {
        'vendors': int('${VENDOR_COUNT:-0}'),
        'jobs': int('${JOB_COUNT:-0}'),
        'subcontracts': int('${SC_COUNT:-0}'),
        'routingCodes': int('${RC_CODES:-0}'),
        'routingApprovers': int('${RC_APPROVERS:-0}'),
        'durationMs': 0
    }
}
with open('$STATUS_FILE', 'w') as f:
    json.dump(status, f, indent=2)
print('  Status file updated')
"

echo "[$TIMESTAMP] Spectrum refresh complete"
