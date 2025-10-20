// WatchData subscriptions
export const onCreateWatchData = /* GraphQL */ `
  subscription OnCreateWatchData {
    onCreateWatchData {
      deviceId
      timestamp
      heartRate
      isMoving
      motion
      status
    }
  }
`;

export const onUpdateWatchData = /* GraphQL */ `
  subscription OnUpdateWatchData {
    onUpdateWatchData {
      deviceId
      timestamp
      heartRate
      isMoving
      motion
      status
    }
  }
`;

export const onDeleteWatchData = /* GraphQL */ `
  subscription OnDeleteWatchData {
    onDeleteWatchData {
      deviceId
      timestamp
      heartRate
      isMoving
      motion
      status
    }
  }
`;

// Caretaker subscriptions
export const onCreateCaretaker = /* GraphQL */ `
  subscription OnCreateCaretaker {
    onCreateCaretaker {
      caretakerID
      name
      email
      assignedElderly
    }
  }
`;

export const onUpdateCaretaker = /* GraphQL */ `
  subscription OnUpdateCaretaker {
    onUpdateCaretaker {
      caretakerID
      name
      email
      assignedElderly
    }
  }
`;

export const onDeleteCaretaker = /* GraphQL */ `
  subscription OnDeleteCaretaker {
    onDeleteCaretaker {
      caretakerID
      name
      email
      assignedElderly
    }
  }
`;
