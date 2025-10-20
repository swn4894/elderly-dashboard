// WatchData queries
export const getWatchData = /* GraphQL */ `
  query GetWatchData($deviceId: String!, $timestamp: String!) {
    getWatchData(deviceId: $deviceId, timestamp: $timestamp) {
      deviceId
      timestamp
      heartRate
      isMoving
      motion
      status
    }
  }
`;

export const listWatchData = /* GraphQL */ `
  query ListWatchData($filter: TableWatchDataFilterInput, $limit: Int, $nextToken: String) {
    listWatchData(filter: $filter, limit: $limit, nextToken: $nextToken) {
      items {
        deviceId
        timestamp
        heartRate
        isMoving
        motion
        status
      }
      nextToken
    }
  }
`;

// Caretaker queries
export const getCaretaker = /* GraphQL */ `
  query GetCaretaker($caretakerID: ID!) {
    getCaretaker(caretakerID: $caretakerID) {
      caretakerID
      username
      name
      email
      assignedElderly
    }
  }
`;
// Caretaker queries
export const getCaretakerByUsername = /* GraphQL */ `
  query GetCaretakerByUsername($username: String!) {
    getCaretakerByUsername(username: $username) {
      caretakerID
      username
      name
      email
      assignedElderly
    }
  }
`;
export const listCaretakers = /* GraphQL */ `
  query ListCaretakers($filter: TableCaretakerFilterInput, $limit: Int, $nextToken: String) {
    listCaretakers(filter: $filter, limit: $limit, nextToken: $nextToken) {
      items {
        caretakerID
        name
        email
        assignedElderly
      }
      nextToken
    }
  }
`;

export const getDashboardData = /* GraphQL */ `
  query GetDashboardData($caretakerID: ID!) {
    getDashboardData(caretakerID: $caretakerID) {
      caretaker {
        caretakerID
        name
        email
        assignedElderly
      }
      watchData {
        deviceId
        timestamp
        heartRate
        isMoving
        motion
        status
      }
    }
  }
`;
