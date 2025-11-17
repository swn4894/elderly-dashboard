#!/bin/bash

# Patient Management CLI Tool
# For user: rediet2

PROFILE="elderly-dashboard"
REGION="us-east-2"
TABLE="Elderly"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "👥 PATIENT MANAGEMENT TOOL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Your 4 device mappings
declare -A DEVICES
DEVICES[1]="WATCH-QM5PQZHO:patient-watch-qm5pqzho"
DEVICES[2]="WATCH-49039479:patient-watch-49039479"
DEVICES[3]="WATCH-B97XWUTY:patient-watch-b97xwuty"
DEVICES[4]="WATCH-G7YFMTE8:patient-watch-g7yfmte8"

show_menu() {
    echo "What would you like to do?"
    echo ""
    echo "  1) View all patients"
    echo "  2) Update patient name"
    echo "  3) Update patient details (name, age, notes)"
    echo "  4) Add a new patient"
    echo "  5) Remove a patient"
    echo "  6) Exit"
    echo ""
    read -p "Enter choice [1-6]: " choice
}

view_patients() {
    echo ""
    echo -e "${BLUE}📋 Your Patients:${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    aws dynamodb scan \
        --table-name $TABLE \
        --filter-expression "caretakerID = :cid" \
        --expression-attribute-values '{":cid": {"S": "775077"}}' \
        --profile $PROFILE \
        --region $REGION \
        --output json | jq -r '.Items[] | "Device: \(.deviceId.S)\nName: \(.name.S)\nAge: \(.age.N // "N/A")\nNotes: \(.medicalNotes.S // "None")\n---"'

    echo ""
}

update_patient_name() {
    echo ""
    echo "Your devices:"
    echo "  1) WATCH-QM5PQZHO (Patient 1)"
    echo "  2) WATCH-49039479 (Patient 2)"
    echo "  3) WATCH-B97XWUTY (Patient 3)"
    echo "  4) WATCH-G7YFMTE8 (Patient 4)"
    echo ""
    read -p "Select patient [1-4]: " patient_num

    if [[ ! $patient_num =~ ^[1-4]$ ]]; then
        echo "Invalid selection"
        return
    fi

    IFS=':' read -r device_id patient_id <<< "${DEVICES[$patient_num]}"

    read -p "Enter new name: " new_name

    if [ -z "$new_name" ]; then
        echo "Name cannot be empty"
        return
    fi

    echo ""
    echo "Updating patient..."

    aws dynamodb update-item \
        --table-name $TABLE \
        --key "{\"elderlyID\": {\"S\": \"$patient_id\"}}" \
        --update-expression "SET #n = :name" \
        --expression-attribute-names '{"#n": "name"}' \
        --expression-attribute-values "{\":name\": {\"S\": \"$new_name\"}}" \
        --profile $PROFILE \
        --region $REGION

    echo -e "${GREEN}✓ Patient name updated to: $new_name${NC}"
    echo ""
}

update_patient_full() {
    echo ""
    echo "Your devices:"
    echo "  1) WATCH-QM5PQZHO (Patient 1)"
    echo "  2) WATCH-49039479 (Patient 2)"
    echo "  3) WATCH-B97XWUTY (Patient 3)"
    echo "  4) WATCH-G7YFMTE8 (Patient 4)"
    echo ""
    read -p "Select patient [1-4]: " patient_num

    if [[ ! $patient_num =~ ^[1-4]$ ]]; then
        echo "Invalid selection"
        return
    fi

    IFS=':' read -r device_id patient_id <<< "${DEVICES[$patient_num]}"

    read -p "Enter name: " new_name
    read -p "Enter age: " new_age
    read -p "Enter medical notes: " new_notes

    if [ -z "$new_name" ]; then
        echo "Name cannot be empty"
        return
    fi

    echo ""
    echo "Updating patient..."

    aws dynamodb update-item \
        --table-name $TABLE \
        --key "{\"elderlyID\": {\"S\": \"$patient_id\"}}" \
        --update-expression "SET #n = :name, age = :age, medicalNotes = :notes" \
        --expression-attribute-names '{"#n": "name"}' \
        --expression-attribute-values "{
            \":name\": {\"S\": \"$new_name\"},
            \":age\": {\"N\": \"$new_age\"},
            \":notes\": {\"S\": \"$new_notes\"}
        }" \
        --profile $PROFILE \
        --region $REGION

    echo -e "${GREEN}✓ Patient updated successfully${NC}"
    echo ""
}

add_patient() {
    echo ""
    read -p "Enter device ID (e.g., WATCH-ABC123): " device_id
    read -p "Enter patient name: " patient_name
    read -p "Enter age: " patient_age
    read -p "Enter medical notes (optional): " medical_notes

    if [ -z "$device_id" ] || [ -z "$patient_name" ]; then
        echo "Device ID and name are required"
        return
    fi

    patient_id="patient-$(echo $device_id | tr '[:upper:]' '[:lower:]')"

    echo ""
    echo "Adding patient..."

    aws dynamodb put-item \
        --table-name $TABLE \
        --item "{
            \"elderlyID\": {\"S\": \"$patient_id\"},
            \"deviceId\": {\"S\": \"$device_id\"},
            \"name\": {\"S\": \"$patient_name\"},
            \"age\": {\"N\": \"$patient_age\"},
            \"medicalNotes\": {\"S\": \"$medical_notes\"},
            \"caretakerID\": {\"S\": \"775077\"}
        }" \
        --profile $PROFILE \
        --region $REGION

    echo -e "${GREEN}✓ Patient added successfully${NC}"
    echo ""
}

remove_patient() {
    echo ""
    echo "Your devices:"
    echo "  1) WATCH-QM5PQZHO (Patient 1)"
    echo "  2) WATCH-49039479 (Patient 2)"
    echo "  3) WATCH-B97XWUTY (Patient 3)"
    echo "  4) WATCH-G7YFMTE8 (Patient 4)"
    echo ""
    read -p "Select patient to remove [1-4]: " patient_num

    if [[ ! $patient_num =~ ^[1-4]$ ]]; then
        echo "Invalid selection"
        return
    fi

    IFS=':' read -r device_id patient_id <<< "${DEVICES[$patient_num]}"

    read -p "Are you sure you want to remove this patient? (yes/no): " confirm

    if [ "$confirm" != "yes" ]; then
        echo "Cancelled"
        return
    fi

    echo ""
    echo "Removing patient..."

    aws dynamodb delete-item \
        --table-name $TABLE \
        --key "{\"elderlyID\": {\"S\": \"$patient_id\"}}" \
        --profile $PROFILE \
        --region $REGION

    echo -e "${GREEN}✓ Patient removed${NC}"
    echo ""
}

# Main loop
while true; do
    show_menu

    case $choice in
        1) view_patients ;;
        2) update_patient_name ;;
        3) update_patient_full ;;
        4) add_patient ;;
        5) remove_patient ;;
        6)
            echo ""
            echo "Goodbye!"
            echo ""
            exit 0
            ;;
        *)
            echo "Invalid choice"
            ;;
    esac

    read -p "Press Enter to continue..."
    clear
done
