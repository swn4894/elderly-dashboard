import React, { useEffect, useState, useRef } from "react";
import { Authenticator, useAuthenticator } from "@aws-amplify/ui-react";
import { client } from "./api/amplifyClient";
import { getCaretakerByUsername, listWatchData } from "./graphql/queries";
import { onCreateWatchData } from "./graphql/subscriptions";
import { fetchAuthSession } from "@aws-amplify/auth";
import "@aws-amplify/ui-react/styles.css";

function AppInner() {
  const { user, signOut } = useAuthenticator((context) => [context.user]);
  const [caretaker, setCaretaker] = useState(null);
  const [watchDataByDevice, setWatchDataByDevice] = useState({});
  const [loading, setLoading] = useState(true);
  const subscriptionRefs = useRef({});

  // 🔹 Paginate to always get all items, then slice to 5 most recent
  const fetchRecentWatchData = async (deviceId) => {
    const results = [];
    let nextToken = null;
    try {
      do {
        const resp = await client.graphql({
          query: listWatchData,
          variables: {
            filter: { deviceId: { eq: deviceId } },
            limit: 50, // fetch enough to cover multiple pages
            nextToken,
          },
          authMode: "AMAZON_COGNITO_USER_POOLS",
        });

        const payload = resp?.data?.listWatchData;
        if (!payload) break;
        results.push(...(payload.items || []));
        nextToken = payload.nextToken || null;
      } while (nextToken);

      // ✅ sort by timestamp (newest first) and slice to latest 5
      return results
        .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
        .slice(0, 5);
    } catch (err) {
      console.error(`❌ Error fetching watch data for ${deviceId}:`, err);
      return [];
    }
  };

  const fetchCaretaker = async (username) => {
    try {
      setLoading(true);
      console.log("🔍 Fetching caretaker for username:", username);
      const resp = await client.graphql({
        query: getCaretakerByUsername,
        variables: { username },
        authMode: "AMAZON_COGNITO_USER_POOLS",
      });
      const ct = resp?.data?.getCaretakerByUsername || null;
      setCaretaker(ct);
      return ct;
    } catch (err) {
      console.error("❌ Error fetching caretaker:", err);
      setCaretaker(null);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const loadAllDevicesData = async (deviceIds) => {
    setLoading(true);
    const map = {};
    for (const deviceId of deviceIds) {
      const items = await fetchRecentWatchData(deviceId);
      map[deviceId] = items;
      console.log(`📦 Loaded ${items.length} items for ${deviceId}`);
    }
    setWatchDataByDevice(map);
    setLoading(false);
  };

  const startSubscriptions = async (deviceIds = []) => {
    Object.values(subscriptionRefs.current).forEach((sub) => sub?.unsubscribe?.());
    subscriptionRefs.current = {};

    try {
      const session = await fetchAuthSession();
      const jwt = session?.tokens?.idToken?.toString();

      for (const deviceId of deviceIds) {
        console.log(`🚀 Starting subscription for ${deviceId}`);
        const observable = client.graphql({
          query: onCreateWatchData,
          variables: { deviceId },
          authMode: "AMAZON_COGNITO_USER_POOLS",
          authToken: jwt,
        });

        const sub = observable.subscribe({
          next: ({ data }) => {
            const newItem = data?.onCreateWatchData;
            if (!newItem) return;
            if (newItem.deviceId !== deviceId) return;
            console.log(`🔔 New data for ${deviceId}:`, newItem);

            setWatchDataByDevice((prev) => {
              const curr = prev[deviceId] || [];
              const updated = [newItem, ...curr]
                .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
                .slice(0, 5);
              return { ...prev, [deviceId]: updated };
            });
          },
          error: (err) => {
            console.error(`❌ Subscription error for ${deviceId}:`, err);
          },
        });

        subscriptionRefs.current[deviceId] = sub;
        console.log(`✅ Subscription started for ${deviceId}`);
      }
    } catch (err) {
      console.error("❌ Failed to start subscriptions:", err);
    }
  };

  useEffect(() => {
    if (!user?.username) return;
    (async () => {
      const ct = await fetchCaretaker(user.username);
      if (ct?.assignedElderly?.length > 0) {
        await loadAllDevicesData(ct.assignedElderly);
        await startSubscriptions(ct.assignedElderly);
      } else {
        console.log("ℹ️ Caretaker has no assigned elderly.");
        setWatchDataByDevice({});
      }
    })();
  }, [user]);

  useEffect(() => {
    return () => {
      Object.values(subscriptionRefs.current).forEach((sub) => sub?.unsubscribe?.());
    };
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
              <h3 style={{ color: "#444" }}>
                Elderly {idx + 1}: Device ID {deviceId}
              </h3>
              {items.length > 0 ? (
                <ul>
                  {items.map((d, i) => (
                    <li key={`${d.deviceId}-${d.timestamp}-${i}`}>
                      <strong>{d.timestamp}</strong> — HR: {d.heartRate}, Motion: {d.motion}, Status:{" "}
                      {d.status}
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
