type DataLayerValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Record<string, unknown>
  | Array<unknown>;

export type AnalyticsParams = Record<string, DataLayerValue>;
export type ContactClickParams = {
  contact_channel: "whatsapp" | "phone" | "email" | "other";
  contact_location: string;
  source?: string;
  job_id?: string;
  job_title?: string;
  company_name?: string;
  candidate_id?: string;
  candidate_role?: string;
};

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
  }
}

const pushToDataLayer = (payload: Record<string, unknown>) => {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(payload);
};

export const trackEvent = (event: string, params: AnalyticsParams = {}) => {
  pushToDataLayer({
    event,
    ...params,
  });
};

export const trackPageView = (
  pathname: string,
  search: string,
  title: string,
) => {
  trackEvent("page_view", {
    page_path: `${pathname}${search}`,
    page_title: title,
  });
};

export const trackContactClick = (params: ContactClickParams) => {
  const pagePath =
    typeof window !== "undefined"
      ? `${window.location.pathname}${window.location.search}`
      : "";

  trackEvent("contact_click", {
    ...params,
    page_path: pagePath,
  });
};
