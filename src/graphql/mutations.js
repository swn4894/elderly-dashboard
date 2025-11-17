// WatchData mutations
export const createWatchData = /* GraphQL */ `
  mutation CreateWatchData($input: CreateWatchDataInput!) {
    createWatchData(input: $input) {
      deviceId
      timestamp
      heartRate
      isMoving
      motion
      status
    }
  }
`;

export const updateWatchData = /* GraphQL */ `
  mutation UpdateWatchData($input: UpdateWatchDataInput!) {
    updateWatchData(input: $input) {
      deviceId
      timestamp
      heartRate
      isMoving
      motion
      status
    }
  }
`;

export const deleteWatchData = /* GraphQL */ `
  mutation DeleteWatchData($input: DeleteWatchDataInput!) {
    deleteWatchData(input: $input) {
      deviceId
      timestamp
      heartRate
      isMoving
      motion
      status
    }
  }
`;

// Caretaker mutations
export const createCaretaker = /* GraphQL */ `
  mutation CreateCaretaker($input: CreateCaretakerInput!) {
    createCaretaker(input: $input) {
      caretakerID
      username
      name
      email
      assignedElderly
    }
  }
`;

export const updateCaretaker = /* GraphQL */ `
  mutation UpdateCaretaker($input: UpdateCaretakerInput!) {
    updateCaretaker(input: $input) {
      caretakerID
      name
      email
      assignedElderly
    }
  }
`;

export const deleteCaretaker = /* GraphQL */ `
  mutation DeleteCaretaker($input: DeleteCaretakerInput!) {
    deleteCaretaker(input: $input) {
      caretakerID
    }
  }
`;

// Elderly mutations
export const createElderly = /* GraphQL */ `
  mutation CreateElderly($input: CreateElderlyInput!) {
    createElderly(input: $input) {
      elderlyID
      deviceId
      name
      age
      medicalNotes
      caretakerID
      familyMemberName
      familyMemberRelationship
      familyMemberEmail
    }
  }
`;

export const updateElderly = /* GraphQL */ `
  mutation UpdateElderly($input: UpdateElderlyInput!) {
    updateElderly(input: $input) {
      elderlyID
      deviceId
      name
      age
      medicalNotes
      caretakerID
      familyMemberName
      familyMemberRelationship
      familyMemberEmail
    }
  }
`;

export const deleteElderly = /* GraphQL */ `
  mutation DeleteElderly($input: DeleteElderlyInput!) {
    deleteElderly(input: $input) {
      elderlyID
      deviceId
      name
      age
      medicalNotes
      caretakerID
    }
  }
`;
