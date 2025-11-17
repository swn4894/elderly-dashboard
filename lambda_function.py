"""
Lambda function to send SNS notifications for heart rate alerts.
This function is triggered by DynamoDB Streams when new WatchData is inserted.
It publishes alerts to SNS topic which distributes to all subscribers (caregivers and family members).
"""

import json
import boto3
import os
from decimal import Decimal

# Initialize AWS clients
sns = boto3.client('sns', region_name='us-east-2')
ses = boto3.client('ses', region_name='us-east-2')
dynamodb = boto3.resource('dynamodb', region_name='us-east-2')

# Get SNS Topic ARN from environment variable
SNS_TOPIC_ARN = os.environ.get('CRITICAL_TOPIC_ARN', 'arn:aws:sns:us-east-2:430500291308:GuardianCare-CriticalAlerts')

# Get DynamoDB tables
elderly_table = dynamodb.Table('Elderly')
caretaker_table = dynamodb.Table('Caretakers')


def lambda_handler(event, context):
    """
    Main handler for DynamoDB Stream events.
    Processes new WatchData inserts and sends email alerts for abnormal heart rates.
    """
    print(f"📥 Received event: {json.dumps(event)}")

    for record in event['Records']:
        # Only process INSERT events
        if record['eventName'] != 'INSERT':
            print(f"⏭️ Skipping {record['eventName']} event")
            continue

        # Parse DynamoDB record
        new_image = record['dynamodb'].get('NewImage', {})

        # Extract heart rate
        heart_rate = None
        if 'heartRate' in new_image:
            heart_rate = int(new_image['heartRate'].get('N', 0))

        device_id = new_image.get('deviceId', {}).get('S', 'Unknown')
        timestamp = new_image.get('timestamp', {}).get('S', 'Unknown')

        print(f"💓 Processing: deviceId={device_id}, heartRate={heart_rate}")

        # Check alert conditions (HIGH: >= 90, LOW: < 50)
        if heart_rate and (heart_rate >= 90 or heart_rate < 50):
            alert_type = 'LOW' if heart_rate < 50 else 'HIGH'
            print(f"⚠️ ALERT: {alert_type} heart rate detected - {heart_rate} BPM")

            # Get patient and caregiver information
            patient_info = get_patient_info(device_id)
            if patient_info:
                send_sns_notification(patient_info, heart_rate, alert_type, timestamp)
            else:
                print(f"❌ Could not find patient info for device: {device_id}")
        else:
            print(f"✅ Heart rate normal: {heart_rate} BPM")

    return {'statusCode': 200, 'body': json.dumps('Processed successfully')}


def get_patient_info(device_id):
    """
    Retrieve patient and caregiver information from DynamoDB.

    Args:
        device_id: The device ID of the patient

    Returns:
        Dictionary with patient info, caregiver email, and family member info
    """
    try:
        # Query Elderly table by deviceId using GSI
        print(f"🔍 Querying Elderly table for deviceId: {device_id}")
        response = elderly_table.query(
            IndexName='deviceId-index',
            KeyConditionExpression='deviceId = :deviceId',
            ExpressionAttributeValues={':deviceId': device_id}
        )

        if not response['Items']:
            print(f"❌ No patient found for deviceId: {device_id}")
            return None

        patient = response['Items'][0]
        print(f"✅ Found patient: {patient.get('name', 'Unknown')}")

        # Get caregiver information
        caretaker_id = patient.get('caretakerID')
        caregiver_email = None
        caregiver_name = None

        if caretaker_id:
            print(f"🔍 Fetching caregiver info for ID: {caretaker_id}")
            try:
                caregiver_response = caretaker_table.get_item(
                    Key={'caretakerID': int(caretaker_id)}
                )
                if 'Item' in caregiver_response:
                    caregiver_email = caregiver_response['Item'].get('email')
                    caregiver_name = caregiver_response['Item'].get('name')
                    print(f"✅ Found caregiver: {caregiver_name} ({caregiver_email})")
            except Exception as e:
                print(f"⚠️ Error fetching caregiver: {str(e)}")

        return {
            'patient_name': patient.get('name', 'Unknown Patient'),
            'patient_age': patient.get('age'),
            'device_id': device_id,
            'caregiver_email': caregiver_email,
            'caregiver_name': caregiver_name,
            'family_member_name': patient.get('familyMemberName'),
            'family_member_relationship': patient.get('familyMemberRelationship'),
            'family_member_email': patient.get('familyMemberEmail'),
        }
    except Exception as e:
        print(f"❌ Error getting patient info: {str(e)}")
        return None


def send_alert_emails(patient_info, heart_rate, alert_type, timestamp):
    """
    Send email alerts to caregiver and family member.

    Args:
        patient_info: Dictionary with patient, caregiver, and family member info
        heart_rate: The heart rate value
        alert_type: 'LOW' or 'HIGH'
        timestamp: Timestamp of the reading
    """
    # Prepare list of recipients
    recipients = []

    # Add caregiver email
    if patient_info['caregiver_email']:
        recipients.append({
            'email': patient_info['caregiver_email'],
            'name': patient_info['caregiver_name'] or 'Caregiver',
            'role': 'Caregiver'
        })

    # Add family member email
    if patient_info['family_member_email']:
        recipients.append({
            'email': patient_info['family_member_email'],
            'name': patient_info['family_member_name'] or 'Family Member',
            'role': patient_info['family_member_relationship'] or 'Family Member'
        })

    if not recipients:
        print("⚠️ No email recipients configured for this patient")
        return

    # Send email to each recipient
    for recipient in recipients:
        print(f"📧 Sending email to {recipient['name']} ({recipient['email']})")
        send_email(
            to_email=recipient['email'],
            recipient_name=recipient['name'],
            recipient_role=recipient['role'],
            patient_info=patient_info,
            heart_rate=heart_rate,
            alert_type=alert_type,
            timestamp=timestamp
        )


def send_email(to_email, recipient_name, recipient_role, patient_info, heart_rate, alert_type, timestamp):
    """
    Send individual email notification with proper headers to avoid spam.
    """
    subject = f"Heart Rate Alert: {patient_info['patient_name']} - {alert_type} ({heart_rate} BPM)"

    # Build patient details
    patient_details = f"""
        <tr>
            <td style="padding: 10px 0; color: #86868b;">Patient Name:</td>
            <td style="padding: 10px 0; font-weight: bold;">{patient_info['patient_name']}</td>
        </tr>
        <tr>
            <td style="padding: 10px 0; color: #86868b;">Device ID:</td>
            <td style="padding: 10px 0; font-weight: bold; font-family: monospace;">{patient_info['device_id']}</td>
        </tr>
        <tr>
            <td style="padding: 10px 0; color: #86868b;">Heart Rate:</td>
            <td style="padding: 10px 0; font-weight: bold; color: {'#ff3b30' if alert_type == 'LOW' else '#ff9500'}; font-size: 24px;">
                {heart_rate} BPM
            </td>
        </tr>
        <tr>
            <td style="padding: 10px 0; color: #86868b;">Timestamp:</td>
            <td style="padding: 10px 0; font-weight: bold;">{timestamp}</td>
        </tr>
        <tr>
            <td style="padding: 10px 0; color: #86868b;">Normal Range:</td>
            <td style="padding: 10px 0; font-weight: bold;">50-89 BPM</td>
        </tr>
    """

    # Plain text version (important for spam filters)
    body_text = f"""
HEART RATE ALERT - {alert_type}

Dear {recipient_name} ({recipient_role}),

This is an automated alert from the Elderly Monitoring System.
{'A critically low' if alert_type == 'LOW' else 'An elevated'} heart rate has been detected for {patient_info['patient_name']}.

PATIENT INFORMATION:
--------------------
Patient Name: {patient_info['patient_name']}
Device ID: {patient_info['device_id']}
Heart Rate: {heart_rate} BPM
Timestamp: {timestamp}
Normal Range: 50-89 BPM

RECOMMENDED ACTION:
{'Please check on the patient immediately. A heart rate below 50 BPM requires urgent attention.' if alert_type == 'LOW' else 'Please monitor the patient closely. Consider checking their activity level and stress.'}

---
This is an automated alert from the Elderly Monitoring System.
You are receiving this because you are listed as a {recipient_role} for this patient.

If you have any questions, please contact your healthcare provider.
    """

    body_html = f"""
    <html>
        <head></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: {'#ff3b30' if alert_type == 'LOW' else '#ff9500'};
                            color: white; padding: 20px; border-radius: 10px; text-align: center;">
                    <h1 style="margin: 0; font-size: 28px; font-weight: 600;">Heart Rate Alert</h1>
                    <p style="font-size: 18px; margin: 10px 0 0 0; font-weight: 500;">
                        {alert_type} Heart Rate Detected
                    </p>
                </div>

                <div style="background: #f5f5f7; padding: 24px; border-radius: 10px; margin-top: 20px;">
                    <p style="margin: 0 0 12px 0; font-size: 14px; color: #86868b;">
                        Dear {recipient_name} ({recipient_role}),
                    </p>
                    <p style="margin: 12px 0; font-size: 14px; color: #1d1d1f;">
                        This is an automated alert from the Elderly Monitoring System.
                        {'A critically low' if alert_type == 'LOW' else 'An elevated'} heart rate has been detected
                        for {patient_info['patient_name']}.
                    </p>

                    <h2 style="color: #1d1d1f; margin: 20px 0 16px 0; font-size: 18px; font-weight: 600;">
                        Patient Information
                    </h2>
                    <table style="width: 100%; border-collapse: collapse;">
                        {patient_details}
                    </table>
                </div>

                <div style="background: #{'#fff3f3' if alert_type == 'LOW' else '#fff9f0'};
                            padding: 16px; border-radius: 10px; margin-top: 20px;
                            border-left: 4px solid {'#ff3b30' if alert_type == 'LOW' else '#ff9500'};">
                    <p style="margin: 0; font-size: 14px; color: #1d1d1f; font-weight: 500;">
                        Recommended Action:
                    </p>
                    <p style="margin: 8px 0 0 0; font-size: 13px; color: #1d1d1f;">
                        {'Please check on the patient immediately. A heart rate below 50 BPM requires urgent attention.'
                         if alert_type == 'LOW'
                         else 'Please monitor the patient closely. Consider checking their activity level and stress.'}
                    </p>
                </div>

                <p style="color: #86868b; text-align: center; margin-top: 24px; font-size: 12px;">
                    This is an automated alert from the Elderly Monitoring System.<br/>
                    You are receiving this because you are listed as a {recipient_role} for this patient.
                </p>
            </div>
        </body>
    </html>
    """

    try:
        # Use verified SES email with friendly sender name
        from_email = 'Elderly Monitoring System <pamidess@gmail.com>'
        reply_to = 'pamidess@gmail.com'

        response = ses.send_email(
            Source=from_email,
            Destination={'ToAddresses': [to_email]},
            ReplyToAddresses=[reply_to],
            Message={
                'Subject': {
                    'Data': subject,
                    'Charset': 'UTF-8'
                },
                'Body': {
                    'Text': {
                        'Data': body_text,
                        'Charset': 'UTF-8'
                    },
                    'Html': {
                        'Data': body_html,
                        'Charset': 'UTF-8'
                    }
                }
            }
        )
        print(f"✅ Email sent successfully to {recipient_name}: {response['MessageId']}")
    except Exception as e:
        print(f"❌ Error sending email to {recipient_name}: {str(e)}")
