import { useState } from "react";
import { CENTRAL_URL } from "../config";

/**
 * Custom hook để quản lý subscriptions (thuê bao)
 */
const useSubscriptions = () => {
  const [subscriptions, setSubscriptions] = useState([]);

  const fetchSubscriptions = async () => {
    try {
      const response = await fetch(`${CENTRAL_URL}/api/subscriptions`);
      const data = await response.json();
      if (data.success) {
        setSubscriptions(data.subscriptions || []);
      }
    } catch (err) {
      console.error("[Subscriptions] Fetch error:", err);
    }
  };

  return {
    subscriptions,
    fetchSubscriptions,
  };
};

export default useSubscriptions;
