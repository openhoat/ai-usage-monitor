#!/usr/bin/env bash
#
# Create / update the strict TypeScript quality profile on SonarQube and
# associate it with the ai-usage-monitor project, along with a stricter quality
# gate.
#
# Prerequisites:
#   - SONAR_HOST_URL (e.g. https://sonar.op3n.cloud)
#   - SONAR_TOKEN    (a SonarQube token with admin permissions)
#
# Idempotent: safe to run multiple times.

set -euo pipefail

SONAR_HOST_URL="${SONAR_HOST_URL:?Set SONAR_HOST_URL (e.g. https://sonar.op3n.cloud)}"
SONAR_TOKEN="${SONAR_TOKEN:?Set SONAR_TOKEN}"

# SonarQube user token auth: username = token, password = anything (empty ok)
API_AUTH="${SONAR_TOKEN}:"

# The Sonar way profile to clone as base.
PROFILE_PARENT_NAME="Sonar way"
PROFILE_PARENT_LANG="ts"            # 'ts' = Sonar way for TypeScript
PROFILE_NAME="typescript-strict"    # the new strict profile
PROJECT_KEY="ai-usage-monitor"

GATE_NAME="ai-usage-monitor-strict" # the new strict quality gate

req() {
  curl -sf -u "$API_AUTH" "$@"
}

json_get() {
  # $1 = json string, $2 = key path like ".profiles[0].key"
  python3 -c "import sys,json; d=json.loads(sys.argv[1]); print(d${2})" "$1"
}

echo "== Sonar host: $SONAR_HOST_URL"

#------------------------------------------------------------------------------
# 0. Resolve the parent profile key (Sonar way for TypeScript)
#------------------------------------------------------------------------------
parent_key=""
# shellcheck disable=SC2016
parent_key="$(req -G "$SONAR_HOST_URL/api/qualityprofiles/search" \
  --data-urlencode "language=$PROFILE_PARENT_LANG" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
key = next((p['key'] for p in d['profiles'] if p['name'] == '$PROFILE_PARENT_NAME'), None)
print(key or '')
")"
if [[ -z "$parent_key" ]]; then
  echo "ERROR: parent profile '$PROFILE_PARENT_NAME' ($PROFILE_PARENT_LANG) not found."
  exit 1
fi
echo "Parent profile: $PROFILE_PARENT_NAME = $parent_key"

#------------------------------------------------------------------------------
# 1. Find (or create) the strict profile
#------------------------------------------------------------------------------
profile_key=""
# shellcheck disable=SC2016
profile_key="$(req -G "$SONAR_HOST_URL/api/qualityprofiles/search" \
  --data-urlencode "language=$PROFILE_PARENT_LANG" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
key = next((p['key'] for p in d['profiles'] if p['name'] == '$PROFILE_NAME'), None)
print(key or '')
")"
if [[ -z "$profile_key" ]]; then
  echo "Creating quality profile '$PROFILE_NAME' (copy of $PROFILE_PARENT_NAME)..."
  # shellcheck disable=SC2016
  profile_key="$(req -X POST "$SONAR_HOST_URL/api/qualityprofiles/copy" \
    --data-urlencode "fromKey=$parent_key" \
    --data-urlencode "toName=$PROFILE_NAME" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['key'])")"
  echo "  created: $profile_key"
else
  echo "Quality profile '$PROFILE_NAME' already exists: $profile_key"
fi

#------------------------------------------------------------------------------
# 2. Apply rule overrides (harden thresholds / severities) on the strict profile
#
# activate_rule on an already-active rule replaces its parameters/severity.
# Format per line:  ruleKey|severity|paramName=value[,param2=val2...]
#------------------------------------------------------------------------------
overrides=(
  "typescript:S3776|CRITICAL|threshold=10"     # Cognitive Complexity 15 -> 10
  "typescript:S138|CRITICAL|max=100"           # Function length 200 -> 100
  "typescript:S1479|CRITICAL|maximum=15"       # Switch cases 30 -> 15
  "typescript:S2004|CRITICAL|max=4"            # Function nesting depth 5 -> 4
  "typescript:S4622|CRITICAL|threshold=2"      # Union type constituents 3 -> 2
)

for entry in "${overrides[@]}"; do
  IFS='|' read -r rule sev params <<< "$entry"
  args=(
    -X POST "$SONAR_HOST_URL/api/qualityprofiles/activate_rule"
    --data-urlencode "key=$profile_key"
    --data-urlencode "rule=$rule"
    --data-urlencode "severity=$sev"
  )
  if [[ -n "$params" ]]; then
    args+=(--data-urlencode "params=$params")
  fi
  req "${args[@]}" >/dev/null 2>&1 \
    && echo "  override  $rule (severity=$sev, params='$params')" \
    || echo "  WARN     override failed for $rule (may need different params)"
done

#------------------------------------------------------------------------------
# 3. Activate additional strict rules that Sonar way leaves inactive
#------------------------------------------------------------------------------
extra=(
  # ruleKey|severity
  "typescript:S4204|MAJOR"    # The "any" type should not be used
  "typescript:S1121|MAJOR"    # Assignments should not be made from within sub-expressions
  "typescript:S1244|MAJOR"    # Floating point numbers should not be tested for equality (BUG)
  "typescript:S2123|MAJOR"    # Values should not be uselessly incremented (BUG)
  "typescript:S4328|MINOR"    # Dependencies should be explicit
  "typescript:S4782|MINOR"    # Optional property declarations: no '?' + 'undefined'
  "typescript:S1291|MINOR"    # Track uses of "NOSONAR" comments
  "typescript:S3353|MINOR"    # Unchanged variables should be marked as "const"
  "typescript:S1068|MINOR"    # Unused private class members should be removed
)

for entry in "${extra[@]}"; do
  IFS='|' read -r rule sev <<< "$entry"
  # Only activate if not already active (idempotent + avoid resetting overrides)
  is_active="$(req -G "$SONAR_HOST_URL/api/rules/search" \
    --data-urlencode "qprofile=$profile_key" \
    --data-urlencode "rule_key=$rule" \
    --data-urlencode "ps=1" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['total'])")"
  if [[ "$is_active" == "0" ]]; then
    req -X POST "$SONAR_HOST_URL/api/qualityprofiles/activate_rule" \
      --data-urlencode "key=$profile_key" \
      --data-urlencode "rule=$rule" \
      --data-urlencode "severity=$sev" >/dev/null
    echo "  activate  $rule (severity=$sev)"
  else
    echo "  skip      $rule (already active)"
  fi
done

#------------------------------------------------------------------------------
# 4. Associate the profile with the project
#------------------------------------------------------------------------------
# Check if the project is already associated (avoid redundant call).
associated="$(req -G "$SONAR_HOST_URL/api/qualityprofiles/projects" \
  --data-urlencode "key=$profile_key" \
  --data-urlencode "selected=selected" \
  --data-urlencode "ps=100" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('yes' if any(p['key'] == '$PROJECT_KEY' for p in d.get('results', [])) else 'no')
")"
if [[ "$associated" == "yes" ]]; then
  echo "Project '$PROJECT_KEY' already associated with '$PROFILE_NAME'."
else
  echo "Associating '$PROFILE_NAME' with project '$PROJECT_KEY'..."
  req -X POST "$SONAR_HOST_URL/api/qualityprofiles/add_project" \
    --data-urlencode "language=ts" \
    --data-urlencode "project=$PROJECT_KEY" \
    --data-urlencode "qualityProfile=$PROFILE_NAME" >/dev/null
  echo "  done"
fi

#------------------------------------------------------------------------------
# 5. Create / update the strict quality gate and attach it to the project
#------------------------------------------------------------------------------
gate_exists="$(req -G "$SONAR_HOST_URL/api/qualitygates/list" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('yes' if any(g['name'] == '$GATE_NAME' for g in d['qualitygates']) else 'no')
")"
if [[ "$gate_exists" == "no" ]]; then
  echo "Creating quality gate '$GATE_NAME'..."
  req -X POST "$SONAR_HOST_URL/api/qualitygates/create" \
    --data-urlencode "name=$GATE_NAME" >/dev/null
else
  echo "Quality gate '$GATE_NAME' already exists."
fi

# Conditions: metric|op|error (op: LT/GT = fail when actual is LT/GT error)
conditions=(
  "new_coverage|LT|85"                    # new coverage must stay >= 85%
  "new_duplicated_lines_density|GT|2"     # new duplication <= 2%
  "new_violations|GT|0"                   # no new issues
  "new_security_hotspots_reviewed|LT|100" # all new hotspots reviewed
  "new_bugs|GT|0"                         # no new bugs
)
for entry in "${conditions[@]}"; do
  IFS='|' read -r metric op error <<< "$entry"
  # Remove any existing condition for the same metric (idempotent)
  existing="$(req -G "$SONAR_HOST_URL/api/qualitygates/show" \
    --data-urlencode "name=$GATE_NAME" \
    | python3 -c "
import sys, json
d = json.load(sys.stdin)
c = next((x for x in d.get('conditions', []) if x['metric'] == '$metric'), None)
print(c['id'] if c else '')
")"
  if [[ -n "$existing" ]]; then
    req -X POST "$SONAR_HOST_URL/api/qualitygates/delete_condition" \
      --data-urlencode "id=$existing" >/dev/null
  fi
  req -X POST "$SONAR_HOST_URL/api/qualitygates/create_condition" \
    --data-urlencode "gateName=$GATE_NAME" \
    --data-urlencode "metric=$metric" \
    --data-urlencode "op=$op" \
    --data-urlencode "error=$error" >/dev/null
  echo "  gate condition: $metric $op $error"
done

echo "Selecting quality gate '$GATE_NAME' for project '$PROJECT_KEY'..."
req -X POST "$SONAR_HOST_URL/api/qualitygates/select" \
  --data-urlencode "gateName=$GATE_NAME" \
  --data-urlencode "projectKey=$PROJECT_KEY" >/dev/null
echo "  done"

echo
echo "== SUCCESS =="
echo "  Profile:      $PROFILE_NAME"
echo "  Quality gate: $GATE_NAME"
echo "  Project:      $PROJECT_KEY"
echo
echo "Next: run 'npm run sonar' to re-analyze and validate against the new gate."
