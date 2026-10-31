// Made by `npm run db:snapshot` from the local database. Don't edit it.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "activity_events": {
                  Row: {
                    "created_at": string,"id": number,"kind": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: never,"kind": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: never,"kind"?: string
                  }
                  Relationships: [
                    
                  ]
                },"admin_actions": {
                  Row: {
                    "action": string,"admin_id": string | null,"admin_name": string,"created_at": string,"details": Json | null,"id": number,"target_id": string | null,"target_title": string,"target_type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"admin_id"?: string | null,"admin_name"?: string,"created_at"?: string,"details"?: Json | null,"id"?: never,"target_id"?: string | null,"target_title"?: string,"target_type": string
                  }
                  Update: {
                    "action"?: string,"admin_id"?: string | null,"admin_name"?: string,"created_at"?: string,"details"?: Json | null,"id"?: never,"target_id"?: string | null,"target_title"?: string,"target_type"?: string
                  }
                  Relationships: [
                    
                  ]
                },"admins": {
                  Row: {
                    "is_super": boolean,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "is_super"?: boolean,"user_id": string
                  }
                  Update: {
                    "is_super"?: boolean,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"announcement_dismissals": {
                  Row: {
                    "announcement_id": string,"closed_at": string,"part": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "announcement_id": string,"closed_at"?: string,"part": string,"user_id": string
                  }
                  Update: {
                    "announcement_id"?: string,"closed_at"?: string,"part"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "announcement_dismissals_announcement_id_fkey"
      columns: ["announcement_id"]
isOneToOne: false
      referencedRelation: "announcements"
      referencedColumns: ["id"]
    }
                  ]
                },"announcements": {
                  Row: {
                    "age_max": number | null,"age_min": number | null,"bar_close_after": number,"bar_html": string,"closed_bar_count": number,"closed_cleared_at": string | null,"closed_modal_count": number,"counted_at": string | null,"created_at": string,"created_by": string | null,"education_levels": (string)[],"ends_at": string | null,"field_words": (string)[],"genders": (string)[],"id": string,"is_on": boolean,"matched_count": number | null,"modal_attachment": Json | null,"modal_close_after": number,"modal_size": string,"modal_text": string,"name": string,"pages": (string)[],"presentations_max": number | null,"presentations_min": number | null,"provinces": (string)[],"repeat": string,"roles": (string)[],"show_bar": boolean,"show_modal": boolean,"starts_at": string | null,"town_words": (string)[],"updated_at": string,"announcement_count": number | null,"announcement_is_live": boolean | null
                  }
                  ComputedFields: "announcement_count" | "announcement_is_live"
                  Insert: {
                    "age_max"?: number | null,"age_min"?: number | null,"bar_close_after"?: number,"bar_html"?: string,"closed_bar_count"?: number,"closed_cleared_at"?: string | null,"closed_modal_count"?: number,"counted_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"education_levels"?: (string)[],"ends_at"?: string | null,"field_words"?: (string)[],"genders"?: (string)[],"id"?: string,"is_on"?: boolean,"matched_count"?: number | null,"modal_attachment"?: Json | null,"modal_close_after"?: number,"modal_size"?: string,"modal_text"?: string,"name": string,"pages"?: (string)[],"presentations_max"?: number | null,"presentations_min"?: number | null,"provinces"?: (string)[],"repeat"?: string,"roles"?: (string)[],"show_bar"?: boolean,"show_modal"?: boolean,"starts_at"?: string | null,"town_words"?: (string)[],"updated_at"?: string
                  }
                  Update: {
                    "age_max"?: number | null,"age_min"?: number | null,"bar_close_after"?: number,"bar_html"?: string,"closed_bar_count"?: number,"closed_cleared_at"?: string | null,"closed_modal_count"?: number,"counted_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"education_levels"?: (string)[],"ends_at"?: string | null,"field_words"?: (string)[],"genders"?: (string)[],"id"?: string,"is_on"?: boolean,"matched_count"?: number | null,"modal_attachment"?: Json | null,"modal_close_after"?: number,"modal_size"?: string,"modal_text"?: string,"name"?: string,"pages"?: (string)[],"presentations_max"?: number | null,"presentations_min"?: number | null,"provinces"?: (string)[],"repeat"?: string,"roles"?: (string)[],"show_bar"?: boolean,"show_modal"?: boolean,"starts_at"?: string | null,"town_words"?: (string)[],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"banned_users": {
                  Row: {
                    "banned_at": string,"is_automatic": boolean,"reason": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "banned_at"?: string,"is_automatic"?: boolean,"reason": string,"user_id": string
                  }
                  Update: {
                    "banned_at"?: string,"is_automatic"?: boolean,"reason"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"blocked_email_domains": {
                  Row: {
                    "domain": string
                  }
                  ComputedFields: never
                  Insert: {
                    "domain": string
                  }
                  Update: {
                    "domain"?: string
                  }
                  Relationships: [
                    
                  ]
                },"click_history": {
                  Row: {
                    "created_at": string,"email": string | null,"feature": string,"id": number,"kind": string,"pause_minutes": number | null,"streak": number | null,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email"?: string | null,"feature": string,"id"?: never,"kind": string,"pause_minutes"?: number | null,"streak"?: number | null,"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"email"?: string | null,"feature"?: string,"id"?: never,"kind"?: string,"pause_minutes"?: number | null,"streak"?: number | null,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "click_history_feature_fkey"
      columns: ["feature"]
isOneToOne: false
      referencedRelation: "click_limits"
      referencedColumns: ["feature"]
    }
                  ]
                },"click_limits": {
                  Row: {
                    "ban_after_pauses": number | null,"daily_reset_time_zone": string | null,"feature": string,"first_pause_minutes": number,"label": string,"max_clicks": number,"per_seconds": number,"repeat_pause_minutes": number,"repeat_within_hours": number
                  }
                  ComputedFields: never
                  Insert: {
                    "ban_after_pauses"?: number | null,"daily_reset_time_zone"?: string | null,"feature": string,"first_pause_minutes": number,"label"?: string,"max_clicks": number,"per_seconds": number,"repeat_pause_minutes": number,"repeat_within_hours": number
                  }
                  Update: {
                    "ban_after_pauses"?: number | null,"daily_reset_time_zone"?: string | null,"feature"?: string,"first_pause_minutes"?: number,"label"?: string,"max_clicks"?: number,"per_seconds"?: number,"repeat_pause_minutes"?: number,"repeat_within_hours"?: number
                  }
                  Relationships: [
                    
                  ]
                },"click_rate": {
                  Row: {
                    "clicks": number,"feature": string,"pause_streak": number,"paused_until": string | null,"user_id": string,"window_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "clicks": number,"feature": string,"pause_streak"?: number,"paused_until"?: string | null,"user_id": string,"window_start": string
                  }
                  Update: {
                    "clicks"?: number,"feature"?: string,"pause_streak"?: number,"paused_until"?: string | null,"user_id"?: string,"window_start"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "click_rate_feature_fkey"
      columns: ["feature"]
isOneToOne: false
      referencedRelation: "click_limits"
      referencedColumns: ["feature"]
    }
                  ]
                },"editors": {
                  Row: {
                    "added_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "added_at"?: string,"user_id": string
                  }
                  Update: {
                    "added_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"folder_items": {
                  Row: {
                    "folder_id": string,"owner_id": string,"presentation_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "folder_id": string,"owner_id"?: string,"presentation_id": string
                  }
                  Update: {
                    "folder_id"?: string,"owner_id"?: string,"presentation_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "folder_items_folder_id_fkey"
      columns: ["folder_id"]
isOneToOne: false
      referencedRelation: "folders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "folder_items_presentation_id_fkey"
      columns: ["presentation_id"]
isOneToOne: true
      referencedRelation: "presentations"
      referencedColumns: ["id"]
    }
                  ]
                },"folders": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"owner_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"owner_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"owner_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"maintenance": {
                  Row: {
                    "id": boolean,"is_on": boolean,"message": string,"planned_at": string | null,"started_at": string | null,"started_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: boolean,"is_on"?: boolean,"message"?: string,"planned_at"?: string | null,"started_at"?: string | null,"started_by"?: string | null
                  }
                  Update: {
                    "id"?: boolean,"is_on"?: boolean,"message"?: string,"planned_at"?: string | null,"started_at"?: string | null,"started_by"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"photo_categories": {
                  Row: {
                    "created_at": string,"id": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"photos": {
                  Row: {
                    "created_at": string,"height": number,"id": string,"src": string,"user_id": string,"width": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"height": number,"id"?: string,"src": string,"user_id"?: string,"width": number
                  }
                  Update: {
                    "created_at"?: string,"height"?: number,"id"?: string,"src"?: string,"user_id"?: string,"width"?: number
                  }
                  Relationships: [
                    
                  ]
                },"presentation_like_counts": {
                  Row: {
                    "presentation_id": string,"total": number
                  }
                  ComputedFields: never
                  Insert: {
                    "presentation_id": string,"total"?: number
                  }
                  Update: {
                    "presentation_id"?: string,"total"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "presentation_like_counts_presentation_id_fkey"
      columns: ["presentation_id"]
isOneToOne: true
      referencedRelation: "presentations"
      referencedColumns: ["id"]
    }
                  ]
                },"presentation_likes": {
                  Row: {
                    "liked_at": string,"presentation_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "liked_at"?: string,"presentation_id": string,"user_id"?: string
                  }
                  Update: {
                    "liked_at"?: string,"presentation_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "presentation_likes_presentation_id_fkey"
      columns: ["presentation_id"]
isOneToOne: false
      referencedRelation: "presentations"
      referencedColumns: ["id"]
    }
                  ]
                },"presentation_reports": {
                  Row: {
                    "created_at": string,"note": string,"presentation_id": string,"reason": string,"reporter_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"note"?: string,"presentation_id": string,"reason": string,"reporter_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"note"?: string,"presentation_id"?: string,"reason"?: string,"reporter_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "presentation_reports_presentation_id_fkey"
      columns: ["presentation_id"]
isOneToOne: false
      referencedRelation: "presentations"
      referencedColumns: ["id"]
    }
                  ]
                },"presentation_reviewers": {
                  Row: {
                    "approved_at": string | null,"approved_by": string | null,"email": string,"id": string,"name": string,"presentation_id": string,"reviewed_on": string,"reviewer_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"email": string,"id"?: string,"name": string,"presentation_id": string,"reviewed_on": string,"reviewer_id"?: string | null
                  }
                  Update: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"email"?: string,"id"?: string,"name"?: string,"presentation_id"?: string,"reviewed_on"?: string,"reviewer_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "presentation_reviewers_presentation_id_fkey"
      columns: ["presentation_id"]
isOneToOne: false
      referencedRelation: "presentations"
      referencedColumns: ["id"]
    }
                  ]
                },"presentation_reviews": {
                  Row: {
                    "admin_note": string | null,"canceled_by_admin": boolean,"draft": Json | null,"draft_updated_at": string | null,"draft_version": number,"ended_at": string | null,"first_submitted_at": string | null,"is_author_update": boolean,"last_reviewer_id": string | null,"open_to_all": boolean,"presentation_id": string,"reviewer_id": string | null,"started_at": string | null,"status": string | null,"submitted_at": string | null,"submitted_fields": Json | null
                  }
                  ComputedFields: never
                  Insert: {
                    "admin_note"?: string | null,"canceled_by_admin"?: boolean,"draft"?: Json | null,"draft_updated_at"?: string | null,"draft_version"?: number,"ended_at"?: string | null,"first_submitted_at"?: string | null,"is_author_update"?: boolean,"last_reviewer_id"?: string | null,"open_to_all"?: boolean,"presentation_id": string,"reviewer_id"?: string | null,"started_at"?: string | null,"status"?: string | null,"submitted_at"?: string | null,"submitted_fields"?: Json | null
                  }
                  Update: {
                    "admin_note"?: string | null,"canceled_by_admin"?: boolean,"draft"?: Json | null,"draft_updated_at"?: string | null,"draft_version"?: number,"ended_at"?: string | null,"first_submitted_at"?: string | null,"is_author_update"?: boolean,"last_reviewer_id"?: string | null,"open_to_all"?: boolean,"presentation_id"?: string,"reviewer_id"?: string | null,"started_at"?: string | null,"status"?: string | null,"submitted_at"?: string | null,"submitted_fields"?: Json | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "presentation_reviews_presentation_id_fkey"
      columns: ["presentation_id"]
isOneToOne: true
      referencedRelation: "presentations"
      referencedColumns: ["id"]
    }
                  ]
                },"presentation_submissions": {
                  Row: {
                    "admin_note": string | null,"copy_id": string | null,"decided_at": string | null,"decided_by": string | null,"id": string,"presentation_id": string | null,"status": string,"submitted_at": string,"submitter_id": string | null,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "admin_note"?: string | null,"copy_id"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"id"?: string,"presentation_id"?: string | null,"status": string,"submitted_at"?: string,"submitter_id"?: string | null,"title"?: string
                  }
                  Update: {
                    "admin_note"?: string | null,"copy_id"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"id"?: string,"presentation_id"?: string | null,"status"?: string,"submitted_at"?: string,"submitter_id"?: string | null,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "presentation_submissions_copy_id_fkey"
      columns: ["copy_id"]
isOneToOne: false
      referencedRelation: "presentations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "presentation_submissions_presentation_id_fkey"
      columns: ["presentation_id"]
isOneToOne: true
      referencedRelation: "presentations"
      referencedColumns: ["id"]
    }
                  ]
                },"presentations": {
                  Row: {
                    "author": string,"author_id": string | null,"copied_from": string | null,"created_at": string,"curriculum": string,"data_version": number,"day": string,"description": string,"from_admin": boolean,"grades": (string)[],"hidden_at": string | null,"id": string,"is_published": boolean,"learning_competency": string,"owner_id": string,"reference_links": (string)[],"search_text": string | null,"shared_at": string | null,"shared_from": string | null,"subject": string,"tags": (string)[],"tags_text": string | null,"term": string,"title": string,"transition": string,"transition_speed": number,"updated_at": string,"week": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author"?: string,"author_id"?: string | null,"copied_from"?: string | null,"created_at"?: string,"curriculum"?: string,"data_version"?: number,"day"?: string,"description"?: string,"from_admin"?: boolean,"grades"?: (string)[],"hidden_at"?: string | null,"id": string,"is_published"?: boolean,"learning_competency"?: string,"owner_id"?: string,"reference_links"?: (string)[],"search_text"?: never,"shared_at"?: string | null,"shared_from"?: string | null,"subject"?: string,"tags"?: (string)[],"tags_text"?: never,"term"?: string,"title"?: string,"transition"?: string,"transition_speed"?: number,"updated_at"?: string,"week"?: string
                  }
                  Update: {
                    "author"?: string,"author_id"?: string | null,"copied_from"?: string | null,"created_at"?: string,"curriculum"?: string,"data_version"?: number,"day"?: string,"description"?: string,"from_admin"?: boolean,"grades"?: (string)[],"hidden_at"?: string | null,"id"?: string,"is_published"?: boolean,"learning_competency"?: string,"owner_id"?: string,"reference_links"?: (string)[],"search_text"?: never,"shared_at"?: string | null,"shared_from"?: string | null,"subject"?: string,"tags"?: (string)[],"tags_text"?: never,"term"?: string,"title"?: string,"transition"?: string,"transition_speed"?: number,"updated_at"?: string,"week"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "presentations_shared_from_fkey"
      columns: ["shared_from"]
isOneToOne: true
      referencedRelation: "presentations"
      referencedColumns: ["id"]
    }
                  ]
                },"profile_photos": {
                  Row: {
                    "changes": number,"day": string | null,"src": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "changes"?: number,"day"?: string | null,"src"?: string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "changes"?: number,"day"?: string | null,"src"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profile_photos_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "editors"
      referencedColumns: ["user_id"]
    }
                  ]
                },"saved_presentations": {
                  Row: {
                    "presentation_id": string,"saved_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "presentation_id": string,"saved_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "presentation_id"?: string,"saved_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "saved_presentations_presentation_id_fkey"
      columns: ["presentation_id"]
isOneToOne: false
      referencedRelation: "presentations"
      referencedColumns: ["id"]
    }
                  ]
                },"shared_photos": {
                  Row: {
                    "bytes": number | null,"category_id": string,"created_at": string,"description": string,"file_name": string,"height": number,"is_public": boolean,"source": string,"src": string,"tags": (string)[],"uploaded_by": string | null,"width": number
                  }
                  ComputedFields: never
                  Insert: {
                    "bytes"?: number | null,"category_id": string,"created_at"?: string,"description"?: string,"file_name"?: string,"height": number,"is_public"?: boolean,"source"?: string,"src": string,"tags"?: (string)[],"uploaded_by"?: string | null,"width": number
                  }
                  Update: {
                    "bytes"?: number | null,"category_id"?: string,"created_at"?: string,"description"?: string,"file_name"?: string,"height"?: number,"is_public"?: boolean,"source"?: string,"src"?: string,"tags"?: (string)[],"uploaded_by"?: string | null,"width"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "shared_photos_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "photo_categories"
      referencedColumns: ["id"]
    }
                  ]
                },"sign_up_attempts": {
                  Row: {
                    "created_at": string,"ip": unknown
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"ip": unknown
                  }
                  Update: {
                    "created_at"?: string,"ip"?: unknown
                  }
                  Relationships: [
                    
                  ]
                },"slide_photos": {
                  Row: {
                    "presentation_id": string,"slide_id": string,"src": string
                  }
                  ComputedFields: never
                  Insert: {
                    "presentation_id": string,"slide_id": string,"src": string
                  }
                  Update: {
                    "presentation_id"?: string,"slide_id"?: string,"src"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "slide_photos_presentation_id_slide_id_fkey"
      columns: ["presentation_id","slide_id"]
isOneToOne: false
      referencedRelation: "slides"
      referencedColumns: ["presentation_id","id"]
    }
                  ]
                },"slides": {
                  Row: {
                    "data": NonNullable<Json>,"id": string,"position": number,"presentation_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "data": NonNullable<Json>,"id": string,"position": number,"presentation_id": string
                  }
                  Update: {
                    "data"?: NonNullable<Json>,"id"?: string,"position"?: number,"presentation_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "slides_presentation_id_fkey"
      columns: ["presentation_id"]
isOneToOne: false
      referencedRelation: "presentations"
      referencedColumns: ["id"]
    }
                  ]
                },"user_settings": {
                  Row: {
                    "bio": string,"bio_public": boolean,"birth_date": string | null,"contact_number": string,"display_name": string,"display_name_changed_at": string | null,"education_field": string,"education_level": string,"education_public": boolean,"favorite_element_categories": (string)[],"first_name": string,"full_name_public": boolean,"gender": string,"last_name": string,"profile_slug": string | null,"province": string,"terms_accepted_at": string | null,"terms_version": string | null,"town": string,"town_public": boolean,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bio"?: string,"bio_public"?: boolean,"birth_date"?: string | null,"contact_number"?: string,"display_name"?: string,"display_name_changed_at"?: string | null,"education_field"?: string,"education_level"?: string,"education_public"?: boolean,"favorite_element_categories"?: (string)[],"first_name"?: string,"full_name_public"?: boolean,"gender"?: string,"last_name"?: string,"profile_slug"?: never,"province"?: string,"terms_accepted_at"?: string | null,"terms_version"?: string | null,"town"?: string,"town_public"?: boolean,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "bio"?: string,"bio_public"?: boolean,"birth_date"?: string | null,"contact_number"?: string,"display_name"?: string,"display_name_changed_at"?: string | null,"education_field"?: string,"education_level"?: string,"education_public"?: boolean,"favorite_element_categories"?: (string)[],"first_name"?: string,"full_name_public"?: boolean,"gender"?: string,"last_name"?: string,"profile_slug"?: never,"province"?: string,"terms_accepted_at"?: string | null,"terms_version"?: string | null,"town"?: string,"town_public"?: boolean,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"write_rate": {
                  Row: {
                    "kind": string,"user_id": string,"window_start": string,"writes": number
                  }
                  ComputedFields: never
                  Insert: {
                    "kind": string,"user_id": string,"window_start": string,"writes": number
                  }
                  Update: {
                    "kind"?: string,"user_id"?: string,"window_start"?: string,"writes"?: number
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            "shared_photo_counts": {
                  Row: {
                    "category_id": string,"no_description": number | null,"no_source": number | null,"photos": number | null,"uploaded_by": string | null,"waiting": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "shared_photos_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "photo_categories"
      referencedColumns: ["id"]
    }
                  ]
                },"shared_photos_search": {
                  Row: {
                    "bytes": number | null,"category_id": string,"category_name": string,"created_at": string,"description": string,"file_name": string,"height": number,"is_public": boolean,"source": string,"src": string,"tags": (string)[],"tags_text": string | null,"uploaded_by": string | null,"width": number
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "shared_photos_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "photo_categories"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "admin_announcements":
{ Args: Record<PropertyKey, never>; Returns: {
              "age_max": number,"age_min": number,"bar_close_after": number,"bar_html": string,"closed_bar": number,"closed_modal": number,"counted_at": string,"created_at": string,"created_by": string,"education_levels": (string)[],"ends_at": string,"field_words": (string)[],"genders": (string)[],"id": string,"is_on": boolean,"matched": number,"modal_attachment": Json,"modal_close_after": number,"modal_size": string,"modal_text": string,"name": string,"pages": (string)[],"presentations_max": number,"presentations_min": number,"provinces": (string)[],"repeat": string,"roles": (string)[],"show_bar": boolean,"show_modal": boolean,"starts_at": string,"status": string,"town_words": (string)[],"updated_at": string
            }[]
                           },
"admin_cancel_review":
{ Args: { "target_id": string }; Returns: undefined
                           },
"admin_editors":
{ Args: Record<PropertyKey, never>; Returns: {
              "added_at": string,"email": string,"last_review": string,"photos": number,"presentations": number,"published_reviews": number,"user_id": string
            }[]
                           },
"admin_log_name":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"admin_may_delete":
{ Args: { "target_id": string }; Returns: boolean
                           },
"admin_overview":
{ Args: { "days": number }; Returns: {
              "day": string,"series": string,"total": number
            }[]
                           },
"admin_remove_profile_photo":
{ Args: { "target": string }; Returns: undefined
                           },
"admin_reviewers":
{ Args: Record<PropertyKey, never>; Returns: {
              "approved_at": string,"approver_email": string,"approver_name": string,"email": string,"name": string,"presentation_id": string,"reviewed_on": string
            }[]
                           },
"admin_reviews":
{ Args: Record<PropertyKey, never>; Returns: {
              "ended_at": string,"is_author_update": boolean,"presentation_id": string,"reviewer_name": string,"started_at": string,"status": string,"submitted_at": string,"title": string
            }[]
                           },
"admin_submissions":
{ Args: Record<PropertyKey, never>; Returns: {
              "editor_email": string,"editor_name": string,"presentation_id": string,"submitted_at": string,"title": string
            }[]
                           },
"admin_teacher_breakdown":
{ Args: Record<PropertyKey, never>; Returns: {
              "kind": string,"label": string,"total": number
            }[]
                           },
"admin_todo_counts":
{ Args: Record<PropertyKey, never>; Returns: {
              "reports": number,"reviews": number,"submissions": number
            }[]
                           },
"admin_used_photo_srcs":
{ Args: Record<PropertyKey, never>; Returns: (string)[]
                           },
"age_on":
{ Args: { "birth": string,"today": string }; Returns: number
                           },
"announce_maintenance":
{ Args: { "note": string,"planned": string }; Returns: undefined
                           },
"announcement_attachment_from_html":
{ Args: { "html": string }; Returns: Json
                           },
"announcement_attachment_ok":
{ Args: { "a": Json }; Returns: boolean
                           },
"announcement_audience":
{ Args: { "a": Json }; Returns: number
                           },
"announcement_count":
{ Args: { "a": Omit<Database["public"]['Tables']["announcements"]['Row'], Database["public"]['Tables']["announcements"]['ComputedFields']> }; Returns: number
                           },
"announcement_is_live":
{ Args: { "a": Omit<Database["public"]['Tables']["announcements"]['Row'], Database["public"]['Tables']["announcements"]['ComputedFields']> }; Returns: boolean
                           },
"announcement_matches":
{ Args: { "a": Omit<Database["public"]['Tables']["announcements"]['Row'], Database["public"]['Tables']["announcements"]['ComputedFields']>,"uid": string }; Returns: boolean
                           },
"announcement_picture_ok":
{ Args: { "a": Json }; Returns: boolean
                           },
"announcement_provinces_ok":
{ Args: { "names": (string)[] }; Returns: boolean
                           },
"announcement_text_from_html":
{ Args: { "html": string }; Returns: string
                           },
"announcement_words_ok":
{ Args: { "words": (string)[] }; Returns: boolean
                           },
"approve_submission":
{ Args: { "target_id": string }; Returns: string
                           },
"cancel_review":
{ Args: { "by_admin": boolean,"target_id": string }; Returns: undefined
                           },
"check_announcement_limit":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"check_maintenance":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"check_review_draft":
{ Args: { "review_draft": Json,"target_id": string }; Returns: undefined
                           },
"check_review_version":
{ Args: { "app_version": number,"review": Omit<Database["public"]['Tables']["presentation_reviews"]['Row'], Database["public"]['Tables']["presentation_reviews"]['ComputedFields']> }; Returns: undefined
                           },
"claim_display_name":
{ Args: { "me": string,"slug": string }; Returns: boolean
                           },
"cleanup_announcement_dismissals":
{ Args: { "batch_size"?: number }; Returns: number
                           },
"count_announcement":
{ Args: { "target": string }; Returns: undefined
                           },
"count_click":
{ Args: { "feature": string }; Returns: undefined
                           },
"count_photo_upload":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"count_write":
{ Args: { "kind": string }; Returns: undefined
                           },
"current_data_version":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"delete_announcement":
{ Args: { "target": string }; Returns: undefined
                           },
"dismiss_announcement":
{ Args: { "part": string,"target": string }; Returns: undefined
                           },
"editor_author":
{ Args: { "user_id": string }; Returns: string
                           },
"editor_presentations":
{ Args: { "slug": string }; Returns: {
              "id": string
            }[]
                           },
"grades_from":
{ Args: { "details": Json }; Returns: (string)[]
                           },
"has_publishable_content":
{ Args: { "target_id": string }; Returns: boolean
                           },
"hook_before_user_created":
{ Args: { "event": Json }; Returns: Json
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_banned":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_editor":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_province":
{ Args: { "name": string }; Returns: boolean
                           },
"is_review_locked":
{ Args: { "target_id": string }; Returns: boolean
                           },
"is_super_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"lesson_editor":
{ Args: { "target_id": string }; Returns: string
                           },
"lesson_extras":
{ Args: { "target_id": string }; Returns: {
              "editor_name": string,"editor_slug": string,"id": string,"kind": string,"position": number
            }[]
                           },
"lesson_week":
{ Args: { "target_id": string }; Returns: {
              "editor_name": string,"editor_slug": string,"id": string
            }[]
                           },
"log_admin_action":
{ Args: { "action": string,"details": Json,"target_id": string,"target_title": string,"target_type": string }; Returns: undefined
                           },
"log_ban":
{ Args: { "target": string }; Returns: undefined
                           },
"log_click_release":
{ Args: { "feature": string,"target": string }; Returns: undefined
                           },
"log_unban":
{ Args: { "target": string }; Returns: undefined
                           },
"maintenance_status":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"manila_today":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"my_announcements":
{ Args: Record<PropertyKey, never>; Returns: {
              "bar_close_after": number,"bar_html": string,"created_at": string,"id": string,"modal_attachment": Json,"modal_close_after": number,"modal_size": string,"modal_text": string,"pages": (string)[],"repeat": string,"show_bar": boolean,"show_modal": boolean
            }[]
                           },
"my_open_review":
{ Args: { "target_id": string }; Returns: {
              "admin_note": string | null,
"canceled_by_admin": boolean,
"draft": Json | null,
"draft_updated_at": string | null,
"draft_version": number,
"ended_at": string | null,
"first_submitted_at": string | null,
"is_author_update": boolean,
"last_reviewer_id": string | null,
"open_to_all": boolean,
"presentation_id": string,
"reviewer_id": string | null,
"started_at": string | null,
"status": string | null,
"submitted_at": string | null,
"submitted_fields": Json | null
            }
                          SetofOptions: {
        from: "*"
        to: "presentation_reviews"
        isOneToOne: true
        isSetofReturn: false
      } },
"my_paused_features":
{ Args: Record<PropertyKey, never>; Returns: {
              "feature": string,"paused_until": string
            }[]
                           },
"my_profile_photo":
{ Args: Record<PropertyKey, never>; Returns: {
              "left_today": number,"src": string
            }[]
                           },
"my_reviews":
{ Args: Record<PropertyKey, never>; Returns: {
              "admin_note": string,"canceled_by_admin": boolean,"ended_at": string,"is_author_update": boolean,"presentation_id": string,"started_at": string,"status": string,"submitted_at": string,"title": string
            }[]
                           },
"my_submissions":
{ Args: Record<PropertyKey, never>; Returns: {
              "admin_note": string,"copy_id": string,"id": string,"presentation_id": string,"status": string,"submitted_at": string,"title": string
            }[]
                           },
"photo_waiting_for_approval":
{ Args: { "owner": string,"target_src": string }; Returns: boolean
                           },
"profile_is_visible":
{ Args: { "profile_id": string }; Returns: boolean
                           },
"profile_slug":
{ Args: { "name": string }; Returns: string
                           },
"publish_review":
{ Args: { "target_id": string }; Returns: undefined
                           },
"publish_waiting_photos":
{ Args: { "target_presentation": string }; Returns: undefined
                           },
"publisher_names":
{ Args: { "owner_ids": (string)[] }; Returns: {
              "display_name": string,"user_id": string
            }[]
                           },
"random_name_ending":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"recount_announcement":
{ Args: { "target": string }; Returns: undefined
                           },
"remove_profile_photo":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"review_status":
{ Args: { "target_id": string }; Returns: {
              "can_start": boolean,"is_author": boolean,"is_author_update": boolean,"is_locked": boolean,"is_mine": boolean,"reviewer_name": string,"status": string
            }[]
                           },
"save_announcement":
{ Args: { "a": Json }; Returns: string
                           },
"save_presentation":
{ Args: { "app_version"?: number,"base_updated_at": number,"presentation": Json,"slide_ids": (string)[] }; Returns: number
                           },
"save_review_draft":
{ Args: { "app_version"?: number,"base_updated_at": number,"review_draft": Json,"target_id": string }; Returns: number
                           },
"search_shared_photos":
{ Args: { "query": string }; Returns: {
              "category": string,"description": string,"file_name": string,"height": number,"source": string,"src": string,"tags": (string)[],"width": number
            }[]
                           },
"send_back_review":
{ Args: { "note": string,"target_id": string }; Returns: undefined
                           },
"send_back_submission":
{ Args: { "note": string,"target_id": string }; Returns: undefined
                           },
"set_announcement_on":
{ Args: { "target": string,"turn_on": boolean }; Returns: undefined
                           },
"set_display_name":
{ Args: { "name": string }; Returns: Json
                           },
"set_liked":
{ Args: { "is_liked": boolean,"presentation_id": string }; Returns: string
                           },
"set_maintenance":
{ Args: { "note": string,"turn_on": boolean }; Returns: undefined
                           },
"set_profile_photo":
{ Args: { "src": string }; Returns: number
                           },
"set_review_open":
{ Args: { "is_open": boolean,"target_id": string }; Returns: undefined
                           },
"set_saved":
{ Args: { "is_saved": boolean,"presentation_id": string }; Returns: string
                           },
"share_presentation":
{ Args: { "target_id": string }; Returns: Json
                           },
"slide_photo_srcs":
{ Args: { "data": Json }; Returns: (string)[]
                           },
"start_review":
{ Args: { "target_id": string }; Returns: undefined
                           },
"stop_review":
{ Args: { "target_id": string }; Returns: undefined
                           },
"submission_status":
{ Args: { "target_id": string }; Returns: {
              "admin_note": string,"status": string,"submitted_at": string
            }[]
                           },
"submit_presentation":
{ Args: { "target_id": string }; Returns: undefined
                           },
"submit_review":
{ Args: { "app_version"?: number,"base_updated_at": number,"review_draft": Json,"reviewed_on": string,"target_id": string }; Returns: undefined
                           },
"tags_text":
{ Args: { "tags": (string)[] }; Returns: string
                           },
"teacher_profile":
{ Args: { "slug": string }; Returns: {
              "bio": string,"bio_public": boolean,"display_name": string,"education_field": string,"education_level": string,"education_public": boolean,"first_name": string,"full_name_public": boolean,"last_name": string,"photo_src": string,"province": string,"town": string,"town_public": boolean
            }[]
                           },
"teacher_shared_presentations":
{ Args: { "slug": string }; Returns: {
              "id": string
            }[]
                           },
"unshare_presentation":
{ Args: { "target_id": string }; Returns: undefined
                           },
"used_photo_srcs":
{ Args: Record<PropertyKey, never>; Returns: (string)[]
                           },
"visible_profiles":
{ Args: { "profile_ids": (string)[] }; Returns: {
              "id": string,"slug": string
            }[]
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
