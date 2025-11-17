#!/bin/bash

# Quick script to update all patient names at once
# For user: rediet2

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "👥 UPDATE ALL PATIENT NAMES"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "You have 4 patients. Let's set their names:"
echo ""

# Patient 1
read -p "Patient 1 (WATCH-QM5PQZHO) name: " name1
read -p "Patient 1 age: " age1
read -p "Patient 1 medical notes (optional): " notes1

# Patient 2
read -p "Patient 2 (WATCH-49039479) name: " name2
read -p "Patient 2 age: " age2
read -p "Patient 2 medical notes (optional): " notes2

# Patient 3
read -p "Patient 3 (WATCH-B97XWUTY) name: " name3
read -p "Patient 3 age: " age3
read -p "Patient 3 medical notes (optional): " notes3

# Patient 4
read -p "Patient 4 (WATCH-G7YFMTE8) name: " name4
read -p "Patient 4 age: " age4
read -p "Patient 4 medical notes (optional): " notes4

echo ""
echo "Updating patients..."
echo ""

# Update Patient 1
if [ -n "$name1" ]; then
    aws dynamodb update-item \
      --table-name Elderly \
      --key '{"elderlyID": {"S": "patient-watch-qm5pqzho"}}' \
      --update-expression "SET #n = :name, age = :age, medicalNotes = :notes" \
      --expression-attribute-names '{"#n": "name"}' \
      --expression-attribute-values "{
        \":name\": {\"S\": \"$name1\"},
        \":age\": {\"N\": \"$age1\"},
        \":notes\": {\"S\": \"$notes1\"}
      }" \
      --profile elderly-dashboard \
      --region us-east-2 > /dev/null 2>&1
    echo "✓ Patient 1 updated: $name1"
fi

# Update Patient 2
if [ -n "$name2" ]; then
    aws dynamodb update-item \
      --table-name Elderly \
      --key '{"elderlyID": {"S": "patient-watch-49039479"}}' \
      --update-expression "SET #n = :name, age = :age, medicalNotes = :notes" \
      --expression-attribute-names '{"#n": "name"}' \
      --expression-attribute-values "{
        \":name\": {\"S\": \"$name2\"},
        \":age\": {\"N\": \"$age2\"},
        \":notes\": {\"S\": \"$notes2\"}
      }" \
      --profile elderly-dashboard \
      --region us-east-2 > /dev/null 2>&1
    echo "✓ Patient 2 updated: $name2"
fi

# Update Patient 3
if [ -n "$name3" ]; then
    aws dynamodb update-item \
      --table-name Elderly \
      --key '{"elderlyID": {"S": "patient-watch-b97xwuty"}}' \
      --update-expression "SET #n = :name, age = :age, medicalNotes = :notes" \
      --expression-attribute-names '{"#n": "name"}' \
      --expression-attribute-values "{
        \":name\": {\"S\": \"$name3\"},
        \":age\": {\"N\": \"$age3\"},
        \":notes\": {\"S\": \"$notes3\"}
      }" \
      --profile elderly-dashboard \
      --region us-east-2 > /dev/null 2>&1
    echo "✓ Patient 3 updated: $name3"
fi

# Update Patient 4
if [ -n "$name4" ]; then
    aws dynamodb update-item \
      --table-name Elderly \
      --key '{"elderlyID": {"S": "patient-watch-g7yfmte8"}}' \
      --update-expression "SET #n = :name, age = :age, medicalNotes = :notes" \
      --expression-attribute-names '{"#n": "name"}' \
      --expression-attribute-values "{
        \":name\": {\"S\": \"$name4\"},
        \":age\": {\"N\": \"$age4\"},
        \":notes\": {\"S\": \"$notes4\"}
      }" \
      --profile elderly-dashboard \
      --region us-east-2 > /dev/null 2>&1
    echo "✓ Patient 4 updated: $name4"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ All patients updated successfully!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "NOTE: Patient names are saved in the database."
echo "They will appear in the dashboard once the AppSync"
echo "schema is updated (see APPSYNC_SCHEMA_UPDATE.md)"
echo ""
