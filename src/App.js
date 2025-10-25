import React, { useEffect, useState, useRef } from "react";
import { Authenticator, useAuthenticator } from "@aws-amplify/ui-react";
import { client } from "./api/amplifyClient";
import { getCaretakerByUsername, listWatchData } from "./graphql/queries";
import { onCreateWatchData } from "./graphql/subscriptions";
import "@aws-amplify/ui-react/styles.css";

function AppInner() {
  const { user, signOut } = useAuthenticator((ctx) => [ctx.user]);
  const [caretaker, setCaretaker] = useState(null);
  const [watchDataByDevice, setWatchDataByDevice] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedPerson, setSelectedPerson] = useState(null);
  const subscriptionRef = useRef(null);

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

                return (
                  <div
                    key={deviceId}
                    onClick={() => setSelectedPerson({ deviceId, index: idx })}
                    style={{
                      background: 'white',
                      borderRadius: '18px',
                      padding: '24px',
                      boxShadow: '0 2px 12px rgba(0, 0, 0, 0.06)',
                      transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                      cursor: 'pointer',
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.transform = 'translateY(-4px)';
                      e.currentTarget.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.12)';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 2px 12px rgba(0, 0, 0, 0.06)';
                    }}
                  >
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
                          Person {idx + 1}
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
                          background: getStatusColor(latest.status),
                          boxShadow: `0 0 0 4px ${getStatusColor(latest.status)}20`,
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
                            color: getStatusColor(latest.status),
                            textTransform: 'capitalize',
                          }}>
                            {latest.status}
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
                    Recent Activity - Person {idx + 1}
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
                        {items.map((d, i) => (
                          <tr
                            key={`${d.deviceId}-${d.timestamp}-${i}`}
                            style={{
                              borderBottom: i < items.length - 1 ? '1px solid rgba(0, 0, 0, 0.05)' : 'none',
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
                              fontWeight: 500,
                              color: '#1d1d1f',
                            }}>
                              {d.heartRate} bpm
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
                                background: `${getStatusColor(d.status)}20`,
                                color: getStatusColor(d.status),
                                padding: '4px 10px',
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: 500,
                                textTransform: 'capitalize',
                              }}>
                                {d.status}
                              </span>
                            </td>
                          </tr>
                        ))}
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
                  Person {selectedPerson.index + 1}
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
