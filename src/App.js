import React, { useEffect, useState, useRef } from "react";
import { Authenticator, useAuthenticator } from "@aws-amplify/ui-react";
import { client } from "./api/amplifyClient";
import { getCaretakerByUsername, listWatchData, listElderly, listCaretakers } from "./graphql/queries";
import { onCreateWatchData } from "./graphql/subscriptions";
import { createElderly, updateElderly, deleteElderly, updateCaretaker, createWatchData, createCaretaker, deleteCaretaker } from "./graphql/mutations";
import "@aws-amplify/ui-react/styles.css";

function AppInner() {
  const { user, signOut } = useAuthenticator((ctx) => [ctx.user]);
  const [caretaker, setCaretaker] = useState(null);
  const [watchDataByDevice, setWatchDataByDevice] = useState({});
  const [elderlyByDeviceId, setElderlyByDeviceId] = useState({});
  const [allElderly, setAllElderly] = useState([]); // Store all patients
  const [loading, setLoading] = useState(true);
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [lowHeartRateAlert, setLowHeartRateAlert] = useState(null);
  const [showManagePatients, setShowManagePatients] = useState(false);
  const [editingPatient, setEditingPatient] = useState(null);
  const [savingPatient, setSavingPatient] = useState(false);
  const [showManageCaregivers, setShowManageCaregivers] = useState(false);
  const [allCaregivers, setAllCaregivers] = useState([]);
  const [editingCaregiver, setEditingCaregiver] = useState(null);
  const [savingCaregiver, setSavingCaregiver] = useState(false);
  const subscriptionRef = useRef(null);
  const previousHeartRates = useRef({});

  // Generate sample watch data for testing
  const generateSampleData = (deviceId) => {
    const statuses = ['normal', 'warning', 'critical'];
    const data = [];
    const now = new Date();

    for (let i = 0; i < 5; i++) {
      const timestamp = new Date(now - i * 3600000); // 1 hour intervals
      data.push({
        deviceId,
        timestamp: timestamp.toISOString(),
        heartRate: Math.floor(Math.random() * 40) + 60, // 60-100 bpm
        isMoving: Math.random() > 0.5,
        motion: parseFloat((Math.random() * 10).toFixed(1)), // 0-10
        status: statuses[Math.floor(Math.random() * statuses.length)],
      });
    }
    return data;
  };

  // Fetch recent watch data for a device
  const fetchRecentWatchData = async (deviceId) => {
    const results = [];
    let nextToken = null;
    try {
      do {
        const resp = await client.graphql({
          query: listWatchData,
          variables: {
            filter: { deviceId: { eq: deviceId } },
            limit: 50,
            nextToken,
          },
          authMode: "AMAZON_COGNITO_USER_POOLS",
        });

        const payload = resp?.data?.listWatchData;
        if (!payload) break;
        results.push(...(payload.items || []));
        nextToken = payload.nextToken || null;
      } while (nextToken);

      return results
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 5);
    } catch (err) {
      console.error(`Error fetching watch data for ${deviceId}:`, err);
      return [];
    }
  };

  // Fetch caretaker info
  const fetchCaretaker = async (username) => {
    try {
      setLoading(true);
      console.log("🔍 Fetching caretaker for username:", username);
      const resp = await client.graphql({
        query: getCaretakerByUsername,
        variables: { username },
        authMode: "AMAZON_COGNITO_USER_POOLS",
      });
      console.log("📦 GraphQL Response:", resp);
      const ct = resp?.data?.getCaretakerByUsername || null;
      console.log("👤 Caretaker data:", ct);
      setCaretaker(ct);
      return ct;
    } catch (err) {
      console.error("❌ Error fetching caretaker:", err);
      console.error("Error details:", JSON.stringify(err, null, 2));
      setCaretaker(null);
      return null;
    } finally {
      setLoading(false);
    }
  };

  // Load all devices data
  const loadAllDevicesData = async (deviceIds) => {
    setLoading(true);
    const map = {};
    for (const deviceId of deviceIds) {
      const realData = await fetchRecentWatchData(deviceId);
      // If no real data, use sample data
      map[deviceId] = realData.length > 0 ? realData : generateSampleData(deviceId);
    }
    setWatchDataByDevice(map);
    setLoading(false);
  };

  // Check if alert notification should be triggered
  const checkHeartRateAlert = (deviceId, heartRate) => {
    const prevRate = previousHeartRates.current[deviceId];
    previousHeartRates.current[deviceId] = heartRate;

    // Trigger alert for high heart rate (>=90) or low heart rate (<50)
    if (heartRate >= 90 || heartRate < 50) {
      console.log(`⚠️ ALERT: Heart rate ${heartRate < 50 ? 'LOW' : 'HIGH'} for ${deviceId}: ${heartRate} BPM`);

      // Show UI alert for low heart rate
      if (heartRate < 50) {
        const elderly = elderlyByDeviceId[deviceId];
        setLowHeartRateAlert({
          deviceId,
          heartRate,
          patientName: elderly?.name || deviceId,
          timestamp: new Date().toISOString(),
        });
      }

      // TODO: Trigger Lambda function for email notification
      // This would be done via API Gateway or direct Lambda invocation
      // For now, log the alert
      console.log(`📧 Email notification would be sent for ${deviceId}`);
    }
  };

  // Start subscription for new WatchData
  const startSubscription = (deviceIds) => {
    // Clean up old subscription
    subscriptionRef.current?.unsubscribe?.();

    subscriptionRef.current = client
      .graphql({
        query: onCreateWatchData,
        authMode: "AMAZON_COGNITO_USER_POOLS",
      })
      .subscribe({
        next: ({ data }) => {
          const newItem = data?.onCreateWatchData;
          if (!newItem || !deviceIds.includes(newItem.deviceId)) return;

          console.log("🔔 New WatchData:", newItem);

          // Check for heart rate alerts
          if (newItem.heartRate) {
            checkHeartRateAlert(newItem.deviceId, newItem.heartRate);
          }

          setWatchDataByDevice((prev) => {
            const curr = prev[newItem.deviceId] || [];
            const updated = [newItem, ...curr]
              .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
              .slice(0, 5);
            return { ...prev, [newItem.deviceId]: updated };
          });
        },
        error: (err) => console.error("Subscription error:", err),
      });
  };

  // Initial load
  useEffect(() => {
    if (!user?.username) return;
    (async () => {
      // Fetch elderly data first
      await fetchElderlyData();

      const ct = await fetchCaretaker(user.username);
      if (ct?.assignedElderly?.length > 0) {
        await loadAllDevicesData(ct.assignedElderly);
        startSubscription(ct.assignedElderly);
      } else {
        setWatchDataByDevice({});
      }
    })();
  }, [user]);

  // Clean up subscription on unmount
  useEffect(() => {
    return () => subscriptionRef.current?.unsubscribe?.();
  }, []);

  // Fetch elderly data for all device IDs
  const fetchElderlyData = async () => {
    try {
      console.log("🔄 Fetching elderly data from AppSync...");
      const resp = await client.graphql({
        query: listElderly,
        authMode: "AMAZON_COGNITO_USER_POOLS",
      });

      const elderlyList = resp?.data?.listElderly?.items || [];
      console.log("📋 Fetched elderly data:", JSON.stringify(elderlyList, null, 2));

      // Store all elderly patients
      setAllElderly(elderlyList);

      // Also maintain the deviceId map for dashboard display
      // Use the most recent patient for each device
      const elderlyMap = {};
      elderlyList.forEach(elderly => {
        if (elderly.deviceId) {
          elderlyMap[elderly.deviceId] = elderly;
          console.log(`  ✅ Mapped ${elderly.deviceId} -> ${elderly.name}`);
        }
      });
      setElderlyByDeviceId(elderlyMap);
      console.log("📊 Final elderly map:", Object.keys(elderlyMap).length, "patients");
      console.log("📊 Total patients:", elderlyList.length);
      return elderlyMap;
    } catch (err) {
      console.error("❌ Error fetching elderly data:", err);
      console.error("Full error:", JSON.stringify(err, null, 2));
      return {};
    }
  };

  // Fetch all caregivers
  const fetchAllCaregivers = async () => {
    try {
      console.log("🔄 Fetching caregivers from AppSync...");
      const resp = await client.graphql({
        query: listCaretakers,
        authMode: "AMAZON_COGNITO_USER_POOLS",
      });

      const caregiversList = resp?.data?.listCaretakers?.items || [];
      console.log("📋 Fetched caregivers:", JSON.stringify(caregiversList, null, 2));
      setAllCaregivers(caregiversList);
      return caregiversList;
    } catch (err) {
      console.error("❌ Error fetching caregivers:", err);
      console.error("Full error:", JSON.stringify(err, null, 2));
      return [];
    }
  };

  // Get color based on heart rate thresholds
  const getHeartRateColor = (heartRate) => {
    if (heartRate < 50) return '#ff3b30'; // Red - Low (critical)
    if (heartRate < 80) return '#34c759'; // Green - Normal
    if (heartRate < 95) return '#ff9500'; // Orange - High
    return '#ff3b30'; // Red - Critical
  };

  const getHeartRateStatus = (heartRate) => {
    if (heartRate < 50) return 'Low';
    if (heartRate < 80) return 'Normal';
    if (heartRate < 95) return 'High';
    return 'Critical';
  };

  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'normal': return '#34c759';
      case 'warning': return '#ff9500';
      case 'critical': return '#ff3b30';
      default: return '#8e8e93';
    }
  };

  const getLatestReading = (deviceId) => {
    const items = watchDataByDevice[deviceId] || [];
    return items[0] || null;
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f5f5f7',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    }}>
      {/* Header */}
      <header style={{
        background: 'rgba(255, 255, 255, 0.8)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(0, 0, 0, 0.08)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto',
          padding: '16px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <h1 style={{
              margin: 0,
              fontSize: '28px',
              fontWeight: 600,
              color: '#1d1d1f',
              letterSpacing: '-0.5px',
            }}>
              Elderly Monitoring
            </h1>
            <p style={{
              margin: '4px 0 0 0',
              fontSize: '14px',
              color: '#86868b',
              fontWeight: 400,
            }}>
              Welcome, {caretaker?.name || user?.username}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={() => setShowManagePatients(true)}
              style={{
                background: '#007aff',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                padding: '10px 20px',
                fontSize: '14px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseOver={(e) => e.target.style.background = '#0051d5'}
              onMouseOut={(e) => e.target.style.background = '#007aff'}
            >
              Manage Patients
            </button>
            <button
              onClick={async () => {
                await fetchAllCaregivers();
                setShowManageCaregivers(true);
              }}
              style={{
                background: '#34c759',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                padding: '10px 20px',
                fontSize: '14px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseOver={(e) => e.target.style.background = '#248a3d'}
              onMouseOut={(e) => e.target.style.background = '#34c759'}
            >
              Manage Caregivers
            </button>
            <button
              onClick={signOut}
              style={{
                background: '#1d1d1f',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                padding: '10px 20px',
                fontSize: '14px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseOver={(e) => e.target.style.background = '#424245'}
              onMouseOut={(e) => e.target.style.background = '#1d1d1f'}
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '40px 24px',
      }}>
        {loading ? (
          <div style={{
            textAlign: 'center',
            padding: '60px 20px',
          }}>
            <div style={{
              width: '40px',
              height: '40px',
              border: '3px solid rgba(0, 0, 0, 0.1)',
              borderTopColor: '#007aff',
              borderRadius: '50%',
              margin: '0 auto 20px',
              animation: 'spin 0.8s linear infinite',
            }} />
            <p style={{
              color: '#86868b',
              fontSize: '15px',
              fontWeight: 400,
            }}>
              Loading your dashboard...
            </p>
          </div>
        ) : caretaker && caretaker.assignedElderly?.length > 0 ? (
          <>
            <h2 style={{
              fontSize: '22px',
              fontWeight: 600,
              color: '#1d1d1f',
              marginBottom: '24px',
              letterSpacing: '-0.3px',
            }}>
              Monitoring {caretaker.assignedElderly.length} {caretaker.assignedElderly.length === 1 ? 'Person' : 'People'}
            </h2>

            {/* Cards Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              gap: '20px',
              marginBottom: '40px',
            }}>
              {caretaker.assignedElderly.map((deviceId, idx) => {
                const latest = getLatestReading(deviceId);
                const elderly = elderlyByDeviceId[deviceId];
                const patientName = elderly?.name || `Person ${idx + 1}`;
                const heartRateColor = latest?.heartRate ? getHeartRateColor(latest.heartRate) : '#8e8e93';
                const isLowHeartRate = latest?.heartRate && latest.heartRate < 50;
                const isHighHeartRate = latest?.heartRate && latest.heartRate >= 90;
                const isAlertHeartRate = isLowHeartRate || isHighHeartRate;

                return (
                  <div
                    key={deviceId}
                    onClick={() => setSelectedPerson({ deviceId, index: idx, patientName })}
                    style={{
                      background: 'white',
                      borderRadius: '18px',
                      padding: '24px',
                      boxShadow: isAlertHeartRate
                        ? '0 4px 20px rgba(255, 59, 48, 0.3)'
                        : '0 2px 12px rgba(0, 0, 0, 0.06)',
                      transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                      cursor: 'pointer',
                      border: isAlertHeartRate ? '2px solid #ff3b30' : 'none',
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.transform = 'translateY(-4px)';
                      e.currentTarget.style.boxShadow = isAlertHeartRate
                        ? '0 8px 28px rgba(255, 59, 48, 0.4)'
                        : '0 8px 24px rgba(0, 0, 0, 0.12)';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = isAlertHeartRate
                        ? '0 4px 20px rgba(255, 59, 48, 0.3)'
                        : '0 2px 12px rgba(0, 0, 0, 0.06)';
                    }}
                  >
                    {/* Heart Rate Alert Badge */}
                    {isAlertHeartRate && (
                      <div style={{
                        background: '#ff3b30',
                        color: 'white',
                        padding: '6px 12px',
                        borderRadius: '8px',
                        fontSize: '11px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        marginBottom: '12px',
                        display: 'inline-block',
                        animation: 'pulse 2s infinite',
                      }}>
                        ⚠️ ALERT: {isLowHeartRate ? 'Low' : latest.heartRate >= 95 ? 'Critical' : 'High'} Heart Rate
                      </div>
                    )}

                    {/* Card Header */}
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: '20px',
                    }}>
                      <div>
                        <h3 style={{
                          margin: 0,
                          fontSize: '18px',
                          fontWeight: 600,
                          color: '#1d1d1f',
                        }}>
                          {patientName}
                        </h3>
                        <p style={{
                          margin: '4px 0 0 0',
                          fontSize: '13px',
                          color: '#86868b',
                          fontFamily: 'monospace',
                        }}>
                          {deviceId}
                        </p>
                      </div>
                      {latest && (
                        <div style={{
                          width: '12px',
                          height: '12px',
                          borderRadius: '50%',
                          background: heartRateColor,
                          boxShadow: `0 0 0 4px ${heartRateColor}20`,
                        }} />
                      )}
                    </div>

                    {/* Latest Stats */}
                    {latest ? (
                      <div>
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: '16px',
                          marginBottom: '20px',
                        }}>
                          <div style={{
                            background: '#f5f5f7',
                            borderRadius: '12px',
                            padding: '16px',
                          }}>
                            <p style={{
                              margin: 0,
                              fontSize: '11px',
                              color: '#86868b',
                              fontWeight: 500,
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px',
                            }}>
                              Heart Rate
                            </p>
                            <p style={{
                              margin: '8px 0 0 0',
                              fontSize: '28px',
                              fontWeight: 600,
                              color: '#1d1d1f',
                            }}>
                              {latest.heartRate}
                            </p>
                            <p style={{
                              margin: '2px 0 0 0',
                              fontSize: '12px',
                              color: '#86868b',
                            }}>
                              bpm
                            </p>
                          </div>

                          <div style={{
                            background: '#f5f5f7',
                            borderRadius: '12px',
                            padding: '16px',
                          }}>
                            <p style={{
                              margin: 0,
                              fontSize: '11px',
                              color: '#86868b',
                              fontWeight: 500,
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px',
                            }}>
                              Motion
                            </p>
                            <p style={{
                              margin: '8px 0 0 0',
                              fontSize: '28px',
                              fontWeight: 600,
                              color: '#1d1d1f',
                            }}>
                              {latest.motion.toFixed(1)}
                            </p>
                            <p style={{
                              margin: '2px 0 0 0',
                              fontSize: '12px',
                              color: '#86868b',
                            }}>
                              {latest.isMoving ? 'Active' : 'Resting'}
                            </p>
                          </div>
                        </div>

                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '12px 0 0 0',
                          borderTop: '1px solid rgba(0, 0, 0, 0.05)',
                        }}>
                          <span style={{
                            fontSize: '13px',
                            color: '#86868b',
                          }}>
                            {new Date(latest.timestamp).toLocaleString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          <span style={{
                            fontSize: '12px',
                            fontWeight: 600,
                            color: heartRateColor,
                            textTransform: 'capitalize',
                          }}>
                            {getHeartRateStatus(latest.heartRate)}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div style={{
                        textAlign: 'center',
                        padding: '40px 20px',
                      }}>
                        <p style={{
                          margin: 0,
                          fontSize: '14px',
                          color: '#86868b',
                        }}>
                          No data available
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Detailed History Section */}
            {caretaker.assignedElderly.map((deviceId, idx) => {
              const items = watchDataByDevice[deviceId] || [];
              if (items.length === 0) return null;

              const elderly = elderlyByDeviceId[deviceId];
              const patientName = elderly?.name || `Person ${idx + 1}`;

              return (
                <div
                  key={`history-${deviceId}`}
                  style={{
                    background: 'white',
                    borderRadius: '18px',
                    padding: '28px',
                    marginBottom: '20px',
                    boxShadow: '0 2px 12px rgba(0, 0, 0, 0.06)',
                  }}
                >
                  <h3 style={{
                    margin: '0 0 20px 0',
                    fontSize: '18px',
                    fontWeight: 600,
                    color: '#1d1d1f',
                  }}>
                    Recent Activity - {patientName}
                  </h3>

                  <div style={{ overflowX: 'auto' }}>
                    <table style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                    }}>
                      <thead>
                        <tr style={{
                          borderBottom: '1px solid rgba(0, 0, 0, 0.08)',
                        }}>
                          <th style={{
                            padding: '12px 16px',
                            textAlign: 'left',
                            fontSize: '11px',
                            fontWeight: 600,
                            color: '#86868b',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                          }}>Time</th>
                          <th style={{
                            padding: '12px 16px',
                            textAlign: 'left',
                            fontSize: '11px',
                            fontWeight: 600,
                            color: '#86868b',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                          }}>Heart Rate</th>
                          <th style={{
                            padding: '12px 16px',
                            textAlign: 'left',
                            fontSize: '11px',
                            fontWeight: 600,
                            color: '#86868b',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                          }}>Motion</th>
                          <th style={{
                            padding: '12px 16px',
                            textAlign: 'left',
                            fontSize: '11px',
                            fontWeight: 600,
                            color: '#86868b',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                          }}>Activity</th>
                          <th style={{
                            padding: '12px 16px',
                            textAlign: 'left',
                            fontSize: '11px',
                            fontWeight: 600,
                            color: '#86868b',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                          }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((d, i) => {
                          const hrColor = getHeartRateColor(d.heartRate);
                          const hrStatus = getHeartRateStatus(d.heartRate);
                          return (
                            <tr
                              key={`${d.deviceId}-${d.timestamp}-${i}`}
                              style={{
                                borderBottom: i < items.length - 1 ? '1px solid rgba(0, 0, 0, 0.05)' : 'none',
                                background: d.heartRate < 50 ? '#ff3b3010' : 'transparent',
                              }}
                            >
                              <td style={{
                                padding: '16px',
                                fontSize: '14px',
                                color: '#1d1d1f',
                              }}>
                                {new Date(d.timestamp).toLocaleString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </td>
                              <td style={{
                                padding: '16px',
                                fontSize: '14px',
                                fontWeight: 600,
                                color: hrColor,
                              }}>
                                {d.heartRate} bpm
                                {d.heartRate < 50 && (
                                  <span style={{
                                    marginLeft: '8px',
                                    fontSize: '11px',
                                    color: '#ff3b30',
                                    fontWeight: 700,
                                  }}>
                                    ⚠️
                                  </span>
                                )}
                              </td>
                              <td style={{
                                padding: '16px',
                                fontSize: '14px',
                                color: '#1d1d1f',
                              }}>
                                {d.motion.toFixed(1)}
                              </td>
                              <td style={{
                                padding: '16px',
                                fontSize: '14px',
                                color: '#1d1d1f',
                              }}>
                                {d.isMoving ? (
                                  <span style={{
                                    background: '#34c75920',
                                    color: '#34c759',
                                    padding: '4px 10px',
                                    borderRadius: '6px',
                                    fontSize: '12px',
                                    fontWeight: 500,
                                  }}>
                                    Active
                                  </span>
                                ) : (
                                  <span style={{
                                    background: '#86868b20',
                                    color: '#86868b',
                                    padding: '4px 10px',
                                    borderRadius: '6px',
                                    fontSize: '12px',
                                    fontWeight: 500,
                                  }}>
                                    Resting
                                  </span>
                                )}
                              </td>
                              <td style={{
                                padding: '16px',
                                fontSize: '14px',
                              }}>
                                <span style={{
                                  background: `${hrColor}20`,
                                  color: hrColor,
                                  padding: '4px 10px',
                                  borderRadius: '6px',
                                  fontSize: '12px',
                                  fontWeight: 500,
                                  textTransform: 'capitalize',
                                }}>
                                  {hrStatus}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </>
        ) : (
          <div style={{
            textAlign: 'center',
            padding: '80px 20px',
            background: 'white',
            borderRadius: '18px',
            boxShadow: '0 2px 12px rgba(0, 0, 0, 0.06)',
          }}>
            <p style={{
              margin: 0,
              fontSize: '16px',
              color: '#86868b',
            }}>
              No monitoring assignments found
            </p>
          </div>
        )}
      </main>

      {/* Side Panel Detail View */}
      {selectedPerson && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setSelectedPerson(null)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.4)',
              backdropFilter: 'blur(4px)',
              zIndex: 999,
              animation: 'fadeIn 0.2s ease',
            }}
          />

          {/* Side Panel */}
          <div
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              bottom: 0,
              width: '480px',
              maxWidth: '100vw',
              background: 'white',
              boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.15)',
              zIndex: 1000,
              overflowY: 'auto',
              animation: 'slideIn 0.3s ease',
            }}
          >
            {/* Panel Header */}
            <div style={{
              position: 'sticky',
              top: 0,
              background: 'white',
              borderBottom: '1px solid rgba(0, 0, 0, 0.08)',
              padding: '24px',
              zIndex: 10,
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px',
              }}>
                <h2 style={{
                  margin: 0,
                  fontSize: '24px',
                  fontWeight: 600,
                  color: '#1d1d1f',
                }}>
                  {selectedPerson.patientName}
                </h2>
                <button
                  onClick={() => setSelectedPerson(null)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    fontSize: '28px',
                    color: '#86868b',
                    cursor: 'pointer',
                    padding: '0',
                    width: '32px',
                    height: '32px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '50%',
                    transition: 'background 0.2s ease',
                  }}
                  onMouseOver={(e) => e.target.style.background = '#f5f5f7'}
                  onMouseOut={(e) => e.target.style.background = 'transparent'}
                >
                  ×
                </button>
              </div>
              <p style={{
                margin: 0,
                fontSize: '13px',
                color: '#86868b',
                fontFamily: 'monospace',
              }}>
                {selectedPerson.deviceId}
              </p>
            </div>

            {/* Panel Content */}
            <div style={{ padding: '24px' }}>
              {(() => {
                const items = watchDataByDevice[selectedPerson.deviceId] || [];
                const latest = items[0];

                if (!latest) {
                  return (
                    <div style={{
                      textAlign: 'center',
                      padding: '60px 20px',
                    }}>
                      <p style={{
                        margin: 0,
                        fontSize: '15px',
                        color: '#86868b',
                      }}>
                        No data available
                      </p>
                    </div>
                  );
                }

                return (
                  <>
                    {/* Current Status */}
                    <div style={{
                      background: '#f5f5f7',
                      borderRadius: '16px',
                      padding: '24px',
                      marginBottom: '24px',
                    }}>
                      <p style={{
                        margin: '0 0 12px 0',
                        fontSize: '11px',
                        color: '#86868b',
                        fontWeight: 500,
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}>
                        Current Status
                      </p>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                      }}>
                        <div style={{
                          width: '16px',
                          height: '16px',
                          borderRadius: '50%',
                          background: getStatusColor(latest.status),
                          boxShadow: `0 0 0 4px ${getStatusColor(latest.status)}20`,
                        }} />
                        <span style={{
                          fontSize: '20px',
                          fontWeight: 600,
                          color: getStatusColor(latest.status),
                          textTransform: 'capitalize',
                        }}>
                          {latest.status}
                        </span>
                      </div>
                      <p style={{
                        margin: '12px 0 0 0',
                        fontSize: '13px',
                        color: '#86868b',
                      }}>
                        Last updated: {new Date(latest.timestamp).toLocaleString('en-US', {
                          month: 'long',
                          day: 'numeric',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>

                    {/* Vital Signs */}
                    <h3 style={{
                      margin: '0 0 16px 0',
                      fontSize: '18px',
                      fontWeight: 600,
                      color: '#1d1d1f',
                    }}>
                      Vital Signs
                    </h3>

                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '16px',
                      marginBottom: '32px',
                    }}>
                      <div style={{
                        background: 'white',
                        border: '1px solid rgba(0, 0, 0, 0.08)',
                        borderRadius: '14px',
                        padding: '20px',
                      }}>
                        <p style={{
                          margin: 0,
                          fontSize: '11px',
                          color: '#86868b',
                          fontWeight: 500,
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                        }}>
                          Heart Rate
                        </p>
                        <p style={{
                          margin: '12px 0 0 0',
                          fontSize: '36px',
                          fontWeight: 600,
                          color: '#1d1d1f',
                          lineHeight: 1,
                        }}>
                          {latest.heartRate}
                        </p>
                        <p style={{
                          margin: '4px 0 0 0',
                          fontSize: '13px',
                          color: '#86868b',
                        }}>
                          bpm
                        </p>
                      </div>

                      <div style={{
                        background: 'white',
                        border: '1px solid rgba(0, 0, 0, 0.08)',
                        borderRadius: '14px',
                        padding: '20px',
                      }}>
                        <p style={{
                          margin: 0,
                          fontSize: '11px',
                          color: '#86868b',
                          fontWeight: 500,
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                        }}>
                          Motion Level
                        </p>
                        <p style={{
                          margin: '12px 0 0 0',
                          fontSize: '36px',
                          fontWeight: 600,
                          color: '#1d1d1f',
                          lineHeight: 1,
                        }}>
                          {latest.motion.toFixed(1)}
                        </p>
                        <p style={{
                          margin: '4px 0 0 0',
                          fontSize: '13px',
                          color: '#86868b',
                        }}>
                          {latest.isMoving ? 'Active' : 'Resting'}
                        </p>
                      </div>
                    </div>

                    {/* Activity History */}
                    <h3 style={{
                      margin: '0 0 16px 0',
                      fontSize: '18px',
                      fontWeight: 600,
                      color: '#1d1d1f',
                    }}>
                      Recent Activity
                    </h3>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {items.map((item, i) => (
                        <div
                          key={`${item.deviceId}-${item.timestamp}-${i}`}
                          style={{
                            background: i === 0 ? '#f5f5f7' : 'white',
                            border: i === 0 ? 'none' : '1px solid rgba(0, 0, 0, 0.08)',
                            borderRadius: '12px',
                            padding: '16px',
                          }}
                        >
                          <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            marginBottom: '12px',
                          }}>
                            <span style={{
                              fontSize: '14px',
                              fontWeight: 500,
                              color: '#1d1d1f',
                            }}>
                              {new Date(item.timestamp).toLocaleString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                            <span style={{
                              background: `${getStatusColor(item.status)}20`,
                              color: getStatusColor(item.status),
                              padding: '4px 10px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 600,
                              textTransform: 'capitalize',
                            }}>
                              {item.status}
                            </span>
                          </div>

                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr 1fr',
                            gap: '12px',
                          }}>
                            <div>
                              <p style={{
                                margin: 0,
                                fontSize: '11px',
                                color: '#86868b',
                              }}>
                                Heart Rate
                              </p>
                              <p style={{
                                margin: '4px 0 0 0',
                                fontSize: '16px',
                                fontWeight: 600,
                                color: '#1d1d1f',
                              }}>
                                {item.heartRate}
                              </p>
                            </div>

                            <div>
                              <p style={{
                                margin: 0,
                                fontSize: '11px',
                                color: '#86868b',
                              }}>
                                Motion
                              </p>
                              <p style={{
                                margin: '4px 0 0 0',
                                fontSize: '16px',
                                fontWeight: 600,
                                color: '#1d1d1f',
                              }}>
                                {item.motion.toFixed(1)}
                              </p>
                            </div>

                            <div>
                              <p style={{
                                margin: 0,
                                fontSize: '11px',
                                color: '#86868b',
                              }}>
                                Activity
                              </p>
                              <p style={{
                                margin: '4px 0 0 0',
                                fontSize: '16px',
                                fontWeight: 600,
                                color: item.isMoving ? '#34c759' : '#86868b',
                              }}>
                                {item.isMoving ? 'Active' : 'Rest'}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </>
      )}

      {/* Low Heart Rate Alert Modal */}
      {lowHeartRateAlert && (
        <>
          <div
            onClick={() => setLowHeartRateAlert(null)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.6)',
              backdropFilter: 'blur(4px)',
              zIndex: 2000,
              animation: 'fadeIn 0.2s ease',
            }}
          />
          <div style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'white',
            borderRadius: '20px',
            padding: '32px',
            maxWidth: '500px',
            width: '90%',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
            zIndex: 2001,
            animation: 'scaleIn 0.3s ease',
          }}>
            <div style={{
              textAlign: 'center',
              marginBottom: '24px',
            }}>
              <div style={{
                width: '80px',
                height: '80px',
                borderRadius: '50%',
                background: '#ff3b30',
                margin: '0 auto 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '48px',
                animation: 'pulse 2s infinite',
              }}>
                ⚠️
              </div>
              <h2 style={{
                margin: '0 0 12px 0',
                fontSize: '24px',
                fontWeight: 700,
                color: '#ff3b30',
              }}>
                Low Heart Rate Alert
              </h2>
              <p style={{
                margin: 0,
                fontSize: '16px',
                color: '#1d1d1f',
                fontWeight: 600,
              }}>
                {lowHeartRateAlert.patientName}
              </p>
            </div>

            <div style={{
              background: '#f5f5f7',
              borderRadius: '14px',
              padding: '20px',
              marginBottom: '24px',
            }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '16px',
              }}>
                <div>
                  <p style={{
                    margin: '0 0 8px 0',
                    fontSize: '12px',
                    color: '#86868b',
                    fontWeight: 500,
                  }}>
                    Heart Rate
                  </p>
                  <p style={{
                    margin: 0,
                    fontSize: '32px',
                    fontWeight: 700,
                    color: '#ff3b30',
                  }}>
                    {lowHeartRateAlert.heartRate}
                  </p>
                  <p style={{
                    margin: '4px 0 0 0',
                    fontSize: '14px',
                    color: '#86868b',
                  }}>
                    BPM (Normal: 50-80)
                  </p>
                </div>
                <div>
                  <p style={{
                    margin: '0 0 8px 0',
                    fontSize: '12px',
                    color: '#86868b',
                    fontWeight: 500,
                  }}>
                    Device ID
                  </p>
                  <p style={{
                    margin: 0,
                    fontSize: '14px',
                    fontWeight: 500,
                    color: '#1d1d1f',
                    fontFamily: 'monospace',
                    wordBreak: 'break-all',
                  }}>
                    {lowHeartRateAlert.deviceId}
                  </p>
                </div>
              </div>
            </div>

            <p style={{
              margin: '0 0 24px 0',
              fontSize: '14px',
              color: '#86868b',
              textAlign: 'center',
            }}>
              Email notification has been sent to assigned healthcare provider.
            </p>

            <button
              onClick={() => setLowHeartRateAlert(null)}
              style={{
                width: '100%',
                background: '#007aff',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                padding: '14px',
                fontSize: '16px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseOver={(e) => e.target.style.background = '#0051d5'}
              onMouseOut={(e) => e.target.style.background = '#007aff'}
            >
              Acknowledged
            </button>
          </div>
        </>
      )}

      {/* Patient Management Modal */}
      {showManagePatients && (
        <>
          <div
            onClick={() => setShowManagePatients(false)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.4)',
              backdropFilter: 'blur(4px)',
              zIndex: 1500,
              animation: 'fadeIn 0.2s ease',
            }}
          />
          <div style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'white',
            borderRadius: '20px',
            padding: '24px',
            maxWidth: '700px',
            width: 'calc(100% - 32px)',
            maxHeight: '90vh',
            overflowY: 'auto',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.2)',
            zIndex: 1501,
            animation: 'scaleIn 0.3s ease',
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '24px',
            }}>
              <h2 style={{
                margin: 0,
                fontSize: '24px',
                fontWeight: 600,
                color: '#1d1d1f',
              }}>
                Manage Patients
              </h2>
              <button
                onClick={() => setShowManagePatients(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '28px',
                  color: '#86868b',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                ×
              </button>
            </div>

            {/* Patient List */}
            <div style={{
              marginBottom: '24px',
            }}>
              {allElderly.length === 0 ? (
                <p style={{
                  textAlign: 'center',
                  color: '#86868b',
                  fontSize: '14px',
                  padding: '40px 20px',
                }}>
                  No patients found. Add your first patient below.
                </p>
              ) : (
                allElderly.map((elderly) => {
                  const isAssigned = caretaker?.assignedElderly?.includes(elderly.deviceId);
                  return (
                    <div
                      key={elderly.elderlyID}
                      style={{
                        background: isAssigned ? '#f5f5f7' : '#fff',
                        border: isAssigned ? 'none' : '1px solid #e5e5e5',
                        borderRadius: '12px',
                        padding: '16px',
                        marginBottom: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                          <h4 style={{
                            margin: 0,
                            fontSize: '16px',
                            fontWeight: 600,
                            color: '#1d1d1f',
                          }}>
                            {elderly.name}
                          </h4>
                          {isAssigned && (
                            <span style={{
                              background: '#34c759',
                              color: 'white',
                              padding: '2px 8px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 600,
                              textTransform: 'uppercase',
                            }}>
                              Monitoring
                            </span>
                          )}
                        </div>
                        <p style={{
                          margin: 0,
                          fontSize: '13px',
                          color: '#86868b',
                          fontFamily: 'monospace',
                        }}>
                          {elderly.deviceId}
                        </p>
                        {elderly.age && (
                          <p style={{
                            margin: '4px 0 0 0',
                            fontSize: '12px',
                            color: '#86868b',
                          }}>
                            Age: {elderly.age}
                          </p>
                        )}
                        {elderly.familyMemberName && (
                          <p style={{
                            margin: '8px 0 0 0',
                            fontSize: '12px',
                            color: '#86868b',
                          }}>
                            👤 Family Contact: {elderly.familyMemberName}
                            {elderly.familyMemberRelationship && ` (${elderly.familyMemberRelationship})`}
                          </p>
                        )}
                        {elderly.familyMemberEmail && (
                          <p style={{
                            margin: '4px 0 0 0',
                            fontSize: '11px',
                            color: '#86868b',
                            fontFamily: 'monospace',
                          }}>
                            📧 {elderly.familyMemberEmail}
                          </p>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-start' }}>
                        <button
                          onClick={async () => {
                            try {
                              const updatedAssigned = isAssigned
                                ? caretaker.assignedElderly.filter(id => id !== elderly.deviceId)
                                : [...caretaker.assignedElderly, elderly.deviceId];

                              console.log(`${isAssigned ? '➖ Unassigning' : '➕ Assigning'} device:`, elderly.deviceId);

                              await client.graphql({
                                query: updateCaretaker,
                                variables: {
                                  input: {
                                    caretakerID: caretaker.caretakerID,
                                    username: caretaker.username,
                                    assignedElderly: updatedAssigned,
                                  },
                                },
                                authMode: "AMAZON_COGNITO_USER_POOLS",
                              });
                              await fetchCaretaker(user.username);

                              // If unassigning, refresh the page data
                              if (!isAssigned) {
                                await loadAllDevicesData(updatedAssigned);
                                startSubscription(updatedAssigned);
                              }
                            } catch (err) {
                              console.error("Error updating assignment:", err);
                              alert("Failed to update assignment");
                            }
                          }}
                          style={{
                            background: isAssigned ? '#ff9500' : '#34c759',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            padding: '8px 16px',
                            fontSize: '13px',
                            fontWeight: 500,
                            cursor: 'pointer',
                          }}
                        >
                          {isAssigned ? 'Unassign' : 'Assign'}
                        </button>
                        <button
                          onClick={() => setEditingPatient(elderly)}
                          style={{
                            background: '#007aff',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            padding: '8px 16px',
                            fontSize: '13px',
                            fontWeight: 500,
                            cursor: 'pointer',
                          }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={async () => {
                            if (window.confirm(`Are you sure you want to remove ${elderly.name}?`)) {
                              try {
                                await client.graphql({
                                  query: deleteElderly,
                                  variables: {
                                    input: { elderlyID: elderly.elderlyID },
                                  },
                                  authMode: "AMAZON_COGNITO_USER_POOLS",
                                });
                                await fetchElderlyData();
                              } catch (err) {
                                console.error("Error deleting patient:", err);
                                alert("Failed to delete patient");
                              }
                            }
                          }}
                          style={{
                            background: '#ff3b30',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            padding: '8px 16px',
                            fontSize: '13px',
                            fontWeight: 500,
                            cursor: 'pointer',
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Add New Patient Button */}
            <button
              onClick={() => setEditingPatient({ elderlyID: null, name: '', deviceId: '', age: '', medicalNotes: '' })}
              style={{
                width: '100%',
                background: '#34c759',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                padding: '14px',
                fontSize: '16px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseOver={(e) => e.target.style.background = '#248a3d'}
              onMouseOut={(e) => e.target.style.background = '#34c759'}
            >
              + Add New Patient
            </button>
          </div>
        </>
      )}

      {/* Edit/Add Patient Modal */}
      {editingPatient && (
        <>
          <div
            onClick={() => setEditingPatient(null)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.4)',
              backdropFilter: 'blur(4px)',
              zIndex: 1600,
              animation: 'fadeIn 0.2s ease',
            }}
          />
          <div style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'white',
            borderRadius: '20px',
            padding: '24px',
            maxWidth: '500px',
            width: 'calc(100% - 32px)',
            maxHeight: '90vh',
            overflowY: 'auto',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.2)',
            zIndex: 1601,
            animation: 'scaleIn 0.3s ease',
          }}>
            <h2 style={{
              margin: '0 0 24px 0',
              fontSize: '24px',
              fontWeight: 600,
              color: '#1d1d1f',
            }}>
              {editingPatient.elderlyID ? 'Edit Patient' : 'Add New Patient'}
            </h2>

            <form
              key={editingPatient.elderlyID || 'new'}
              onSubmit={async (e) => {
              e.preventDefault();

              setSavingPatient(true);
              const formData = new FormData(e.target);

              // Build data object with only defined values
              const data = {
                name: formData.get('name'),
                // Use deviceId from form if available, otherwise from editingPatient (when disabled)
                deviceId: formData.get('deviceId') || editingPatient.deviceId,
              };

              // Add optional fields only if they have values
              const age = formData.get('age');
              if (age && age.trim() !== '') {
                data.age = parseInt(age);
              }

              const medicalNotes = formData.get('medicalNotes');
              if (medicalNotes && medicalNotes.trim() !== '') {
                data.medicalNotes = medicalNotes;
              }

              const familyMemberName = formData.get('familyMemberName');
              console.log("📋 Family Member Name from form:", familyMemberName);
              if (familyMemberName && familyMemberName.trim() !== '') {
                data.familyMemberName = familyMemberName.trim();
                console.log("✅ Added familyMemberName to data");
              }

              const familyMemberRelationship = formData.get('familyMemberRelationship');
              console.log("📋 Family Member Relationship from form:", familyMemberRelationship);
              if (familyMemberRelationship && familyMemberRelationship.trim() !== '') {
                data.familyMemberRelationship = familyMemberRelationship.trim();
                console.log("✅ Added familyMemberRelationship to data");
              }

              const familyMemberEmail = formData.get('familyMemberEmail');
              console.log("📋 Family Member Email from form:", familyMemberEmail);
              if (familyMemberEmail && familyMemberEmail.trim() !== '') {
                data.familyMemberEmail = familyMemberEmail.trim();
                console.log("✅ Added familyMemberEmail to data");
              }

              if (caretaker?.caretakerID) {
                data.caretakerID = String(caretaker.caretakerID);
              }

              // Get heart rate separately (not saved to Elderly table, only for WatchData)
              const heartRateInput = formData.get('heartRate');
              const heartRate = heartRateInput && heartRateInput.trim() !== '' ? parseInt(heartRateInput) : null;

              console.log("💾 FULL DATA OBJECT TO SAVE:", JSON.stringify(data, null, 2));
              if (heartRate) {
                console.log("💓 Heart rate provided:", heartRate, "BPM");
              }

              try {
                if (editingPatient.elderlyID) {
                  // Update existing - add elderlyID
                  const updateData = { ...data, elderlyID: editingPatient.elderlyID };
                  console.log("📝 Updating patient with elderlyID:", editingPatient.elderlyID);
                  console.log("📝 Full update data:", JSON.stringify(updateData, null, 2));

                  const updateResult = await client.graphql({
                    query: updateElderly,
                    variables: {
                      input: updateData,
                    },
                    authMode: "AMAZON_COGNITO_USER_POOLS",
                  });

                  console.log("✅ Patient updated successfully! Result:", updateResult);
                } else {
                  // Create new
                  console.log("➕ Creating new patient:", data);

                  const result = await client.graphql({
                    query: createElderly,
                    variables: { input: data },
                    authMode: "AMAZON_COGNITO_USER_POOLS",
                  });

                  console.log("✅ Patient created:", result);

                  // Note: Device assignment is managed separately via Assign/Unassign buttons
                  // We don't automatically assign devices anymore
                }

                // Always refresh elderly data first
                console.log("🔄 Refreshing elderly data from database...");
                await fetchElderlyData();
                console.log("✅ Elderly data refreshed");

                // If heart rate was provided and device is assigned, create a WatchData entry
                if (heartRate && data.deviceId) {
                  console.log("💓 Creating watch data entry with heart rate:", heartRate, "for device:", data.deviceId);

                  const timestamp = new Date().toISOString();
                  const newWatchData = {
                    deviceId: data.deviceId,
                    timestamp: timestamp,
                    heartRate: heartRate,
                    isMoving: false,
                    motion: 0.0,
                    status: heartRate >= 95 ? 'critical' : heartRate >= 80 ? 'alert' : heartRate < 50 ? 'low' : 'normal',
                  };

                  try {
                    const watchResult = await client.graphql({
                      query: createWatchData,
                      variables: {
                        input: newWatchData,
                      },
                      authMode: "AMAZON_COGNITO_USER_POOLS",
                    });
                    console.log("✅ Watch data created successfully:", watchResult);

                    // Update local state to show on dashboard immediately
                    setWatchDataByDevice((prev) => {
                      const curr = prev[data.deviceId] || [];
                      const updated = [newWatchData, ...curr]
                        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                        .slice(0, 5);
                      return { ...prev, [data.deviceId]: updated };
                    });

                    // Check for alerts
                    if (heartRate >= 90 || heartRate < 50) {
                      checkHeartRateAlert(data.deviceId, heartRate);
                    }

                    console.log("✅ Patient saved with heart rate data!");
                    alert(`✅ Patient saved! Heart rate ${heartRate} BPM recorded. ${heartRate >= 90 || heartRate < 50 ? 'Alert notification will be sent!' : ''}`);
                  } catch (watchErr) {
                    console.error("❌ Failed to create watch data:", watchErr);
                    alert("✅ Patient saved, but failed to record heart rate: " + (watchErr.errors?.[0]?.message || watchErr.message));
                  }
                } else {
                  console.log("✅ Patient saved successfully!");
                  alert("✅ Patient saved successfully!");
                }

                // Close modal and reset saving state
                setEditingPatient(null);
                setSavingPatient(false);
              } catch (err) {
                console.error("Error saving patient:", err);
                console.error("Full error details:", JSON.stringify(err, null, 2));

                // Extract meaningful error message
                let errorMessage = "Failed to save patient";
                if (err.errors && err.errors.length > 0) {
                  errorMessage = err.errors[0].message;
                } else if (err.message) {
                  errorMessage = err.message;
                }

                alert(`Failed to save patient: ${errorMessage}`);
                setSavingPatient(false);
              }
            }}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#1d1d1f',
                  marginBottom: '8px',
                }}>
                  Patient Name *
                </label>
                <input
                  type="text"
                  name="name"
                  defaultValue={editingPatient.name}
                  required
                  style={{
                    width: '100%',
                    padding: '12px',
                    fontSize: '14px',
                    border: '1px solid rgba(0, 0, 0, 0.1)',
                    borderRadius: '8px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#1d1d1f',
                  marginBottom: '8px',
                }}>
                  Device ID *
                </label>
                <input
                  type="text"
                  name="deviceId"
                  defaultValue={editingPatient.deviceId}
                  required
                  disabled={!!editingPatient.elderlyID}
                  style={{
                    width: '100%',
                    padding: '12px',
                    fontSize: '14px',
                    border: '1px solid rgba(0, 0, 0, 0.1)',
                    borderRadius: '8px',
                    fontFamily: 'monospace',
                    boxSizing: 'border-box',
                    background: editingPatient.elderlyID ? '#f5f5f7' : 'white',
                  }}
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#1d1d1f',
                  marginBottom: '8px',
                }}>
                  Age
                </label>
                <input
                  type="number"
                  name="age"
                  defaultValue={editingPatient.age}
                  style={{
                    width: '100%',
                    padding: '12px',
                    fontSize: '14px',
                    border: '1px solid rgba(0, 0, 0, 0.1)',
                    borderRadius: '8px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#1d1d1f',
                  marginBottom: '8px',
                }}>
                  Medical Notes
                </label>
                <textarea
                  name="medicalNotes"
                  defaultValue={editingPatient.medicalNotes}
                  rows="3"
                  style={{
                    width: '100%',
                    padding: '12px',
                    fontSize: '14px',
                    border: '1px solid rgba(0, 0, 0, 0.1)',
                    borderRadius: '8px',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit',
                    resize: 'vertical',
                  }}
                />
              </div>

              {/* Heart Rate Section - Optional for testing alerts */}
              <div style={{ marginBottom: '24px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#1d1d1f',
                  marginBottom: '8px',
                }}>
                  Heart Rate (BPM) - Optional
                </label>
                <input
                  type="number"
                  name="heartRate"
                  placeholder="e.g., 45 or 85 to test alerts"
                  style={{
                    width: '100%',
                    padding: '12px',
                    fontSize: '14px',
                    border: '1px solid rgba(0, 0, 0, 0.1)',
                    borderRadius: '8px',
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{
                  fontSize: '12px',
                  color: '#86868b',
                  marginTop: '6px',
                }}>
                  Enter heart rate to test email alerts. Values below 50 or above 90 will trigger notifications.
                </div>
              </div>

              {/* Family Member Section */}
              <div style={{
                background: '#f5f5f7',
                padding: '20px',
                borderRadius: '12px',
                marginBottom: '24px',
              }}>
                <h3 style={{
                  margin: '0 0 16px 0',
                  fontSize: '16px',
                  fontWeight: 600,
                  color: '#1d1d1f',
                }}>
                  Family Member Contact
                </h3>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{
                    display: 'block',
                    fontSize: '14px',
                    fontWeight: 500,
                    color: '#1d1d1f',
                    marginBottom: '8px',
                  }}>
                    Family Member Name
                  </label>
                  <input
                    type="text"
                    name="familyMemberName"
                    defaultValue={editingPatient.familyMemberName}
                    placeholder="e.g., John Smith"
                    style={{
                      width: '100%',
                      padding: '12px',
                      fontSize: '14px',
                      border: '1px solid rgba(0, 0, 0, 0.1)',
                      borderRadius: '8px',
                      boxSizing: 'border-box',
                      background: 'white',
                    }}
                  />
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{
                    display: 'block',
                    fontSize: '14px',
                    fontWeight: 500,
                    color: '#1d1d1f',
                    marginBottom: '8px',
                  }}>
                    Relationship
                  </label>
                  <input
                    type="text"
                    name="familyMemberRelationship"
                    defaultValue={editingPatient.familyMemberRelationship}
                    placeholder="e.g., Son, Daughter, Spouse"
                    style={{
                      width: '100%',
                      padding: '12px',
                      fontSize: '14px',
                      border: '1px solid rgba(0, 0, 0, 0.1)',
                      borderRadius: '8px',
                      boxSizing: 'border-box',
                      background: 'white',
                    }}
                  />
                </div>

                <div style={{ marginBottom: '0' }}>
                  <label style={{
                    display: 'block',
                    fontSize: '14px',
                    fontWeight: 500,
                    color: '#1d1d1f',
                    marginBottom: '8px',
                  }}>
                    Email Address
                  </label>
                  <input
                    type="email"
                    name="familyMemberEmail"
                    defaultValue={editingPatient.familyMemberEmail}
                    placeholder="e.g., john@example.com"
                    style={{
                      width: '100%',
                      padding: '12px',
                      fontSize: '14px',
                      border: '1px solid rgba(0, 0, 0, 0.1)',
                      borderRadius: '8px',
                      boxSizing: 'border-box',
                      background: 'white',
                    }}
                  />
                  <p style={{
                    margin: '8px 0 0 0',
                    fontSize: '12px',
                    color: '#86868b',
                  }}>
                    Family member will receive email alerts for critical health events
                  </p>
                </div>
              </div>

              <div style={{
                display: 'flex',
                gap: '12px',
              }}>
                <button
                  type="button"
                  onClick={() => setEditingPatient(null)}
                  style={{
                    flex: 1,
                    background: '#f5f5f7',
                    color: '#1d1d1f',
                    border: 'none',
                    borderRadius: '12px',
                    padding: '14px',
                    fontSize: '16px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingPatient}
                  style={{
                    flex: 1,
                    background: savingPatient ? '#86868b' : '#007aff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '12px',
                    padding: '14px',
                    fontSize: '16px',
                    fontWeight: 600,
                    cursor: savingPatient ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s ease',
                    opacity: savingPatient ? 0.7 : 1,
                  }}
                  onMouseOver={(e) => !savingPatient && (e.target.style.background = '#0051d5')}
                  onMouseOut={(e) => !savingPatient && (e.target.style.background = '#007aff')}
                >
                  {savingPatient ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* Caregiver Management Modal */}
      {showManageCaregivers && (
        <>
          <div
            onClick={() => setShowManageCaregivers(false)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.4)',
              backdropFilter: 'blur(4px)',
              zIndex: 1500,
              animation: 'fadeIn 0.2s ease',
            }}
          />
          <div style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'white',
            borderRadius: '20px',
            padding: '24px',
            maxWidth: '700px',
            width: 'calc(100% - 32px)',
            maxHeight: '90vh',
            overflowY: 'auto',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.2)',
            zIndex: 1501,
            animation: 'scaleIn 0.3s ease',
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '24px',
            }}>
              <h2 style={{
                margin: 0,
                fontSize: '24px',
                fontWeight: 600,
                color: '#1d1d1f',
              }}>
                Manage Caregivers
              </h2>
              <button
                onClick={() => setShowManageCaregivers(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '28px',
                  color: '#86868b',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                ×
              </button>
            </div>

            {/* Caregiver List */}
            <div style={{
              marginBottom: '24px',
            }}>
              {allCaregivers.length === 0 ? (
                <p style={{
                  textAlign: 'center',
                  color: '#86868b',
                  fontSize: '14px',
                  padding: '40px 20px',
                }}>
                  No caregivers found. Add your first caregiver below.
                </p>
              ) : (
                allCaregivers.map((caregiver) => {
                  return (
                    <div
                      key={caregiver.caretakerID}
                      style={{
                        background: '#f5f5f7',
                        borderRadius: '12px',
                        padding: '16px',
                        marginBottom: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <h4 style={{
                            margin: 0,
                            fontSize: '16px',
                            fontWeight: 600,
                            color: '#1d1d1f',
                          }}>
                            {caregiver.name}
                          </h4>
                        </div>
                        <p style={{
                          margin: '4px 0 0 0',
                          fontSize: '13px',
                          color: '#86868b',
                        }}>
                          Username: {caregiver.username}
                        </p>
                        <p style={{
                          margin: '4px 0 0 0',
                          fontSize: '13px',
                          color: '#86868b',
                        }}>
                          Email: {caregiver.email}
                        </p>
                        <p style={{
                          margin: '4px 0 0 0',
                          fontSize: '12px',
                          color: '#86868b',
                        }}>
                          Monitoring {caregiver.assignedElderly?.length || 0} patient(s)
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => setEditingCaregiver(caregiver)}
                          style={{
                            background: '#007aff',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            padding: '8px 16px',
                            fontSize: '13px',
                            fontWeight: 500,
                            cursor: 'pointer',
                          }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={async () => {
                            if (window.confirm(`Are you sure you want to remove ${caregiver.name}?`)) {
                              try {
                                await client.graphql({
                                  query: deleteCaretaker,
                                  variables: {
                                    input: { caretakerID: parseInt(caregiver.caretakerID) }, // Must be Int
                                  },
                                  authMode: "AMAZON_COGNITO_USER_POOLS",
                                });
                                await fetchAllCaregivers();
                                alert("✅ Caregiver deleted successfully!");
                              } catch (err) {
                                console.error("Error deleting caregiver:", err);
                                console.error("Full error details:", JSON.stringify(err, null, 2));
                                alert(`Failed to delete caregiver: ${err.errors?.[0]?.message || err.message}`);
                              }
                            }
                          }}
                          style={{
                            background: '#ff3b30',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            padding: '8px 16px',
                            fontSize: '13px',
                            fontWeight: 500,
                            cursor: 'pointer',
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Add New Caregiver Button */}
            <button
              onClick={() => setEditingCaregiver({ caretakerID: null, username: '', name: '', email: '', assignedElderly: [] })}
              style={{
                width: '100%',
                background: '#34c759',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                padding: '14px',
                fontSize: '16px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseOver={(e) => e.target.style.background = '#248a3d'}
              onMouseOut={(e) => e.target.style.background = '#34c759'}
            >
              + Add New Caregiver
            </button>
          </div>
        </>
      )}

      {/* Edit/Add Caregiver Modal */}
      {editingCaregiver && (
        <>
          <div
            onClick={() => setEditingCaregiver(null)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.4)',
              backdropFilter: 'blur(4px)',
              zIndex: 1600,
              animation: 'fadeIn 0.2s ease',
            }}
          />
          <div style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'white',
            borderRadius: '20px',
            padding: '24px',
            maxWidth: '500px',
            width: 'calc(100% - 32px)',
            maxHeight: '90vh',
            overflowY: 'auto',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.2)',
            zIndex: 1601,
            animation: 'scaleIn 0.3s ease',
          }}>
            <h2 style={{
              margin: '0 0 24px 0',
              fontSize: '24px',
              fontWeight: 600,
              color: '#1d1d1f',
            }}>
              {editingCaregiver.caretakerID ? 'Edit Caregiver' : 'Add New Caregiver'}
            </h2>

            <form
              key={editingCaregiver.caretakerID || 'new'}
              onSubmit={async (e) => {
                e.preventDefault();
                setSavingCaregiver(true);
                const formData = new FormData(e.target);

                // Get selected patients
                const selectedPatients = [];
                allElderly.forEach(elderly => {
                  if (formData.get(`patient_${elderly.deviceId}`) === 'on') {
                    selectedPatients.push(elderly.deviceId);
                  }
                });

                const name = formData.get('name');
                const email = formData.get('email');
                const username = formData.get('username');

                // Validate required fields
                if (!name || name.trim() === '') {
                  alert('Name is required');
                  setSavingCaregiver(false);
                  return;
                }
                if (!email || email.trim() === '') {
                  alert('Email is required');
                  setSavingCaregiver(false);
                  return;
                }

                const data = {
                  name: name.trim(),
                  email: email.trim(),
                  assignedElderly: selectedPatients,
                };

                console.log("💾 Saving caregiver with data:", data);

                try {
                  if (editingCaregiver.caretakerID) {
                    // Update existing - caretakerID must be Int, username is required by schema
                    data.caretakerID = parseInt(editingCaregiver.caretakerID);

                    // Username is required by schema - get from editingCaregiver state (disabled field doesn't submit)
                    if (!editingCaregiver.username) {
                      alert('Error: Username is missing. Please refresh and try again.');
                      setSavingCaregiver(false);
                      return;
                    }
                    data.username = editingCaregiver.username;
                    console.log("📝 Updating caregiver:", data);

                    await client.graphql({
                      query: updateCaretaker,
                      variables: {
                        input: data,
                      },
                      authMode: "AMAZON_COGNITO_USER_POOLS",
                    });
                  } else {
                    // Create new - generate caretakerID as Int, username from form
                    if (!username || username.trim() === '') {
                      alert('Username is required for new caregivers');
                      setSavingCaregiver(false);
                      return;
                    }
                    const newId = Math.floor(Math.random() * 1000000);
                    data.caretakerID = newId;
                    data.username = username.trim();
                    console.log("➕ Creating new caregiver:", data);

                    await client.graphql({
                      query: createCaretaker,
                      variables: { input: data },
                      authMode: "AMAZON_COGNITO_USER_POOLS",
                    });
                  }

                  await fetchAllCaregivers();
                  setEditingCaregiver(null);
                  console.log("✅ Caregiver saved successfully!");
                  alert("✅ Caregiver saved successfully!");
                } catch (err) {
                  console.error("Error saving caregiver:", err);
                  console.error("Full error details:", JSON.stringify(err, null, 2));
                  alert(`Failed to save caregiver: ${err.errors?.[0]?.message || err.message}`);
                } finally {
                  setSavingCaregiver(false);
                }
              }}
            >
              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#1d1d1f',
                  marginBottom: '8px',
                }}>
                  Username *
                </label>
                <input
                  type="text"
                  name="username"
                  defaultValue={editingCaregiver.username || ''}
                  required
                  disabled={!!editingCaregiver.caretakerID}
                  style={{
                    width: '100%',
                    padding: '12px',
                    fontSize: '14px',
                    border: '1px solid rgba(0, 0, 0, 0.1)',
                    borderRadius: '8px',
                    boxSizing: 'border-box',
                    background: editingCaregiver.caretakerID ? '#f5f5f7' : 'white',
                    color: editingCaregiver.caretakerID ? '#86868b' : '#1d1d1f',
                  }}
                />
                {editingCaregiver.caretakerID && (
                  <div style={{
                    fontSize: '12px',
                    color: '#86868b',
                    marginTop: '6px',
                  }}>
                    Username cannot be changed after creation
                  </div>
                )}
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#1d1d1f',
                  marginBottom: '8px',
                }}>
                  Full Name *
                </label>
                <input
                  type="text"
                  name="name"
                  defaultValue={editingCaregiver.name}
                  required
                  style={{
                    width: '100%',
                    padding: '12px',
                    fontSize: '14px',
                    border: '1px solid rgba(0, 0, 0, 0.1)',
                    borderRadius: '8px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#1d1d1f',
                  marginBottom: '8px',
                }}>
                  Email Address *
                </label>
                <input
                  type="email"
                  name="email"
                  defaultValue={editingCaregiver.email}
                  required
                  style={{
                    width: '100%',
                    padding: '12px',
                    fontSize: '14px',
                    border: '1px solid rgba(0, 0, 0, 0.1)',
                    borderRadius: '8px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ marginBottom: '24px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#1d1d1f',
                  marginBottom: '8px',
                }}>
                  Assign Patients
                </label>
                <div style={{
                  background: '#f5f5f7',
                  borderRadius: '8px',
                  padding: '12px',
                  maxHeight: '200px',
                  overflowY: 'auto',
                }}>
                  {allElderly.length === 0 ? (
                    <p style={{
                      margin: 0,
                      fontSize: '13px',
                      color: '#86868b',
                      textAlign: 'center',
                      padding: '20px',
                    }}>
                      No patients available
                    </p>
                  ) : (
                    allElderly.map(elderly => (
                      <div key={elderly.deviceId} style={{
                        padding: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}>
                        <input
                          type="checkbox"
                          name={`patient_${elderly.deviceId}`}
                          id={`patient_${elderly.deviceId}`}
                          defaultChecked={editingCaregiver.assignedElderly?.includes(elderly.deviceId)}
                          style={{
                            width: '18px',
                            height: '18px',
                            cursor: 'pointer',
                          }}
                        />
                        <label
                          htmlFor={`patient_${elderly.deviceId}`}
                          style={{
                            fontSize: '14px',
                            color: '#1d1d1f',
                            cursor: 'pointer',
                          }}
                        >
                          {elderly.name} ({elderly.deviceId})
                        </label>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div style={{
                display: 'flex',
                gap: '12px',
              }}>
                <button
                  type="button"
                  onClick={() => setEditingCaregiver(null)}
                  style={{
                    flex: 1,
                    background: '#f5f5f7',
                    color: '#1d1d1f',
                    border: 'none',
                    borderRadius: '12px',
                    padding: '14px',
                    fontSize: '16px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingCaregiver}
                  style={{
                    flex: 1,
                    background: savingCaregiver ? '#86868b' : '#007aff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '12px',
                    padding: '14px',
                    fontSize: '16px',
                    fontWeight: 600,
                    cursor: savingCaregiver ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s ease',
                    opacity: savingCaregiver ? 0.7 : 1,
                  }}
                  onMouseOver={(e) => !savingCaregiver && (e.target.style.background = '#0051d5')}
                  onMouseOut={(e) => !savingCaregiver && (e.target.style.background = '#007aff')}
                >
                  {savingCaregiver ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      <style>
        {`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }

          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }

          @keyframes slideIn {
            from { transform: translateX(100%); }
            to { transform: translateX(0); }
          }

          @keyframes scaleIn {
            from {
              opacity: 0;
              transform: translate(-50%, -50%) scale(0.9);
            }
            to {
              opacity: 1;
              transform: translate(-50%, -50%) scale(1);
            }
          }

          @keyframes pulse {
            0%, 100% {
              box-shadow: 0 0 0 0 rgba(255, 59, 48, 0.7);
            }
            50% {
              box-shadow: 0 0 0 20px rgba(255, 59, 48, 0);
            }
          }

          * {
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
          }

          @media (max-width: 768px) {
            main {
              padding: 24px 16px !important;
            }

            header > div {
              padding: 12px 16px !important;
            }

            h1 {
              font-size: 22px !important;
            }

            h2 {
              font-size: 18px !important;
            }
          }
        `}
      </style>
    </div>
  );
}

export default function App() {
  return (
    <Authenticator
      loginMechanisms={['username']}
    >
      <AppInner />
    </Authenticator>
  );
}
