## Table `barbers`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `text` | Primary |
| `name` | `text` |  |
| `role` | `text` |  Nullable |
| `img` | `text` |  Nullable |
| `work_days` | `_text` |  Nullable |
| `branch` | `text` |  Nullable |
| `is_active` | `bool` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |
| `outlet_id` | `uuid` |  Nullable |
| `moka_employee_id` | `text` |  Nullable |
| `home_service_enabled` | `bool` |  Nullable |
| `phone` | `text` |  Nullable |

## Table `customers`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `name` | `text` |  |
| `wa` | `text` |  Unique |
| `visits` | `int4` |  Nullable |
| `total_spent` | `int4` |  Nullable |
| `last_visit` | `date` |  Nullable |
| `services` | `_text` |  Nullable |
| `notes` | `text` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |
| `updated_at` | `timestamptz` |  Nullable |
| `phone_e164` | `text` |  Nullable |
| `email` | `text` |  Nullable |
| `source` | `text` |  Nullable |
| `moka_customer_id` | `text` |  Nullable |
| `birth_date` | `date` |  Nullable |
| `birthday` | `text` |  Nullable |
| `gender` | `text` |  Nullable |
| `address` | `text` |  Nullable |
| `fav_barber` | `text` |  Nullable |
| `referral_code` | `text` |  Nullable Unique |
| `points` | `int4` |  |
| `membership_status` | `text` |  |
| `membership_activated_at` | `timestamptz` |  Nullable |
| `last_reminder_at` | `timestamptz` |  Nullable |

## Table `bookings`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `customer_id` | `uuid` |  Nullable |
| `name` | `text` |  |
| `wa` | `text` |  |
| `service_id` | `text` |  |
| `service` | `text` |  |
| `price` | `int4` |  Nullable |
| `duration` | `text` |  Nullable |
| `barber_id` | `text` |  Nullable |
| `date` | `date` |  |
| `time` | `time` |  |
| `location` | `text` |  Nullable |
| `status` | `text` |  Nullable |
| `notes` | `text` |  Nullable |
| `payment` | `text` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |
| `updated_at` | `timestamptz` |  Nullable |
| `schedule_id` | `uuid` |  Nullable |
| `review_sent_at` | `timestamptz` |  Nullable |
| `remind_h1_sent` | `bool` |  |

## Table `outlets`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `name` | `text` |  |
| `slug` | `text` |  Unique |
| `address` | `text` |  Nullable |
| `timezone` | `text` |  |
| `is_active` | `bool` |  |
| `moka_outlet_id` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |
| `last_polled_at` | `timestamptz` |  Nullable |

## Table `services`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `name` | `text` |  |
| `slug` | `text` |  Unique |
| `duration_minutes` | `int4` |  |
| `price` | `int4` |  |
| `is_active` | `bool` |  |
| `moka_item_id` | `text` |  Nullable |
| `moka_category_id` | `text` |  Nullable |
| `moka_category_name` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |
| `moka_variant_name` | `text` |  Nullable |
| `moka_variant_id` | `text` |  Nullable |

## Table `schedules`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `outlet_id` | `uuid` |  |
| `barber_id` | `text` |  Nullable |
| `customer_id` | `uuid` |  Nullable |
| `service_id` | `uuid` |  Nullable |
| `service_name` | `text` |  Nullable |
| `price` | `int4` |  |
| `start_time` | `timestamptz` |  |
| `end_time` | `timestamptz` |  |
| `status` | `text` |  |
| `source` | `text` |  |
| `external_id` | `text` |  Nullable Unique |
| `notes` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `type` | `text` |  Nullable |

## Table `moka_tokens`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `outlet_id` | `uuid` | Primary |
| `access_token` | `text` |  |
| `refresh_token` | `text` |  Nullable |
| `token_type` | `text` |  |
| `expires_at` | `timestamptz` |  |
| `scope` | `text` |  Nullable |
| `updated_at` | `timestamptz` |  |

## Table `sync_logs`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `direction` | `text` |  |
| `entity_type` | `text` |  |
| `entity_id` | `text` |  |
| `payload` | `jsonb` |  Nullable |
| `status` | `text` |  |
| `error_message` | `text` |  Nullable |
| `retry_count` | `int4` |  |
| `created_at` | `timestamptz` |  |

## Table `transactions`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `customer_id` | `uuid` |  Nullable |
| `outlet_id` | `uuid` |  Nullable |
| `schedule_id` | `uuid` |  Nullable |
| `external_id` | `text` |  Nullable Unique |
| `total_amount` | `int4` |  |
| `source` | `text` |  |
| `status` | `text` |  |
| `moka_payload` | `jsonb` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `transaction_items`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `transaction_id` | `uuid` |  |
| `service_name` | `text` |  |
| `price` | `int4` |  |
| `quantity` | `int4` |  |
| `moka_item_id` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `barber_working_hours`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `barber_id` | `text` |  |
| `day_of_week` | `int4` |  |
| `open_time` | `time` |  |
| `close_time` | `time` |  |
| `is_off` | `bool` |  |

## Table `ai_uploads`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `user_id` | `text` |  Nullable |
| `original_image_url` | `text` |  |
| `service_type` | `varchar` |  |
| `status` | `varchar` |  |
| `created_at` | `timestamptz` |  Nullable |
| `completed_at` | `timestamptz` |  Nullable |
| `error_message` | `text` |  Nullable |
| `retry_count` | `int4` |  Nullable |

## Table `ai_results`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `upload_id` | `uuid` |  |
| `user_id` | `text` |  Nullable |
| `analysis_result` | `jsonb` |  Nullable |
| `model_used` | `text` |  Nullable |
| `tokens_used` | `int4` |  Nullable |
| `processing_time_ms` | `int4` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |

## Table `wa_message_status`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `message_id` | `text` | Primary |
| `message_status` | `text` |  Nullable |
| `target` | `text` |  Nullable |
| `payload` | `jsonb` |  Nullable |
| `updated_at` | `timestamptz` |  Nullable |

## Table `wa_conversations`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `sender` | `text` | Primary |
| `history` | `jsonb` |  |
| `updated_at` | `timestamptz` |  |

## Table `otp_codes`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `phone` | `text` |  |
| `code` | `text` |  |
| `attempts` | `int4` |  |
| `verified_at` | `timestamptz` |  Nullable |
| `expires_at` | `timestamptz` |  |
| `created_at` | `timestamptz` |  |

## Table `member_sessions`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `customer_wa` | `text` |  |
| `token` | `uuid` |  Unique |
| `expires_at` | `timestamptz` |  |
| `created_at` | `timestamptz` |  |

## Table `reviews`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `booking_id` | `uuid` |  Nullable |
| `customer_name` | `text` |  Nullable |
| `kapster_id` | `text` |  Nullable |
| `kapster_name` | `text` |  Nullable |
| `branch` | `text` |  Nullable |
| `rating` | `int2` |  |
| `comment` | `text` |  Nullable |
| `is_public` | `bool` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |

## Table `member_profiles`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `user_key` | `text` |  Unique |
| `email` | `text` |  |
| `full_name` | `text` |  Nullable |
| `phone` | `text` |  Nullable |
| `birthdate` | `text` |  Nullable |
| `gender` | `text` |  Nullable |
| `address` | `text` |  Nullable |
| `fav_barber` | `text` |  Nullable |
| `membership_status` | `text` |  Nullable |
| `membership_activated_at` | `timestamptz` |  Nullable |
| `total_points` | `int4` |  Nullable |
| `current_tier` | `text` |  Nullable |
| `referral_code` | `text` |  Nullable Unique |
| `referred_by` | `text` |  Nullable |
| `total_visits` | `int4` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |
| `updated_at` | `timestamptz` |  Nullable |

## Table `member_activations`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `user_key` | `text` |  |
| `amount` | `int4` |  |
| `payment_method` | `text` |  Nullable |
| `status` | `text` |  Nullable |
| `confirmed_by` | `text` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |

## Table `member_point_transactions`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `user_key` | `text` |  |
| `activity` | `text` |  |
| `points` | `int4` |  |
| `notes` | `text` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |

## Table `home_service_jobs`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `schedule_id` | `uuid` |  Nullable |
| `status` | `text` |  Nullable |
| `address` | `text` |  |
| `reschedule_count` | `int4` |  Nullable |
| `barber_enroute_at` | `timestamptz` |  Nullable |
| `barber_done_at` | `timestamptz` |  Nullable |
| `customer_confirmed_at` | `timestamptz` |  Nullable |
| `flagged_at` | `timestamptz` |  Nullable |
| `flag_reason` | `text` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |
| `updated_at` | `timestamptz` |  Nullable |

## Table `wa_paused`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `sender` | `text` | Primary |
| `paused_until` | `timestamptz` |  |
| `paused_at` | `timestamptz` |  Nullable |
| `paused_by` | `text` |  Nullable |

