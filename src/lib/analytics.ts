type DataLayerValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Record<string, unknown>
  | Array<unknown>;

export type AnalyticsParams = Record<string, DataLayerValue>;

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
