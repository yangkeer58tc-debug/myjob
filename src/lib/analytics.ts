type DataLayerValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Record<string, unknown>
  | Array<unknown>;

export type AnalyticsParams = Record<string, DataLayerValue>;
export type IndependentEventName =
  | "home_show"
  | "list_c_show"
  | "list_c_click"
  | "list_b_show"
  | "detail_c_show"
  | "list_c_btn_click"
  | "detail_c_btn_click"
  | "list_b_btn_click";

export type StructuredAnalyticsParams = {
  module: string;
  item_id?: string;
  item_name?: string;
  position?: number;
  cta_name?: string;
};

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

const getPageMetadata = () => {
  if (typeof window === "undefined") {
    return {
      page_path: "",
      page_title: "",
    };
  }

  return {
    page_path: `${window.location.pathname}${window.location.search}`,
    page_title: typeof document !== "undefined" ? document.title : "",
  };
};

export const trackEvent = (event: string, params: AnalyticsParams = {}) => {
  pushToDataLayer({
    event,
    ...params,
  });
};

export const trackStructuredEvent = (
  event: IndependentEventName,
  params: StructuredAnalyticsParams,
) => {
  const { page_path, page_title } = getPageMetadata();

  pushToDataLayer({
    event,
    page_path,
    page_title,
    module: params.module,
    event_version: "v1",
    item_id: params.item_id,
    item_name: params.item_name,
    position: params.position,
    cta_name: params.cta_name,
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
  const { page_path } = getPageMetadata();

  trackEvent("contact_click", {
    ...params,
    page_path,
  });
};
