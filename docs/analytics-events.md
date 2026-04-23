# Analytics Events (GA4 + GTM)

This project pushes custom events to `window.dataLayer` for GTM.

## Core events

- `page_view`
  - `page_path`
  - `page_title`

- `contact_click` (unified contact event)
  - `contact_channel` (`whatsapp` | `phone` | `email` | `other`)
  - `contact_location` (where the click happened)
  - `source` (optional)
  - `page_path` (auto)
  - optional context fields:
    - `job_id`
    - `job_title`
    - `company_name`
    - `candidate_id`
    - `candidate_role`

- `nav_click`
  - `nav_target` (`home` | `jobs` | `candidates`)

- `footer_click`
  - `footer_target` (`home` | `jobs` | `whatsapp_contact`)

- `home_cta_click`
  - `cta_name`
  - `target_path`

- `home_category_click`
  - `category_id`
  - `category_name`

- `home_city_click`
  - `city_name`

- `job_card_click`
  - `job_id`
  - `job_title`
  - `company_name`
  - `page_path`

- `job_apply_click`
  - `job_id`
  - `job_title`
  - `company_name`
  - `source` (`job_card` | `job_detail`)

- `job_search_submit`
  - `query`
  - `city_filter`
  - `category_filter`

- `job_salary_filter_apply`
  - `salary_filter`
  - `payment_filter`

- `job_filters_clear_all`

- `job_list_pagination_click`
  - `target_page`

## GTM suggestion

1. Create Custom Event trigger for each event name you care about.
2. Map event params into GA4 Event tag parameters.
3. Publish GTM container.
