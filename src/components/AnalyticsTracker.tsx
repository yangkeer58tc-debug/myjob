import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { trackPageView } from "@/lib/analytics";

const AnalyticsTracker = () => {
  const location = useLocation();

  useEffect(() => {
    trackPageView(
      location.pathname,
      location.search,
      typeof document !== "undefined" ? document.title : "",
    );
  }, [location.pathname, location.search]);

  return null;
};

export default AnalyticsTracker;
