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
  const subscriptionRef = useRef(null);

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
      const resp = await client.graphql({
        query: getCaretakerByUsername,
        variables: { username },
        authMode: "AMAZON_COGNITO_USER_POOLS",
      });
      const ct = resp?.data?.getCaretakerByUsername || null;
      setCaretaker(ct);
      return ct;
    } catch (err) {
      console.error("Error fetching caretaker:", err);
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
      map[deviceId] = await fetchRecentWatchData(deviceId);
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

  return (
    <div style={{ padding: 20, fontFamily: "Arial" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Welcome, {user?.username}</h1>
        <button
          onClick={signOut}
          style={{
            background: "#e63946",
            color: "white",
            border: "none",
            borderRadius: 8,
            padding: "8px 14px",
            cursor: "pointer",
          }}
        >
          Sign Out
        </button>
      </div>

      <h2>Your Assigned Elderly</h2>
      {loading ? (
        <p>Loading dashboard...</p>
      ) : caretaker && caretaker.assignedElderly?.length > 0 ? (
        caretaker.assignedElderly.map((deviceId, idx) => {
          const items = watchDataByDevice[deviceId] || [];
          return (
            <div key={deviceId} style={{ marginBottom: 24 }}>
              <h3>
                Elderly {idx + 1}: Device ID {deviceId}
              </h3>
              {items.length > 0 ? (
                <ul>
                  {items.map((d, i) => (
                    <li key={`${d.deviceId}-${d.timestamp}-${i}`}>
                      <strong>{d.timestamp}</strong> — HR: {d.heartRate}, Motion: {d.motion}, Status: {d.status}, Moving: {d.isMoving ? "Yes" : "No"}
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ color: "gray" }}>No watch data found for this device.</p>
              )}
            </div>
          );
        })
      ) : (
        <p style={{ color: "gray" }}>No caretaker found.</p>
      )}
    </div>
  );
}

export default function App() {
  return (
    <Authenticator>
      <AppInner />
    </Authenticator>
  );
}
