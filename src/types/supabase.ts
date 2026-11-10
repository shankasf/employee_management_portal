export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// Schedule status type
export type ScheduleStatus =
  | 'pending'
  | 'confirmed'
  | 'cancellation_requested'
  | 'cancelled'
  | 'completed';

// ID document type
export type IdDocumentType = 'drivers_license' | 'passport' | 'state_id' | 'other';

// Media type for policies
export type MediaType = 'none' | 'image' | 'video';

// Notification recipient type
export type RecipientType = 'manager' | 'owner';

// Email type for schedule notifications
export type ScheduleEmailType =
  | 'schedule_assigned'
  | 'schedule_confirmed'
  | 'cancellation_requested'
  | 'cancellation_approved'
  | 'schedule_cancelled_by_admin';

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string | null;
          full_name: string | null;
          role: "admin" | "employee";
          status: "active" | "inactive";
          is_super_admin: boolean;
          admin_scoped: boolean;
          reset_token_hash: string | null;
          reset_token_expires: string | null;
          email_confirmed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          full_name?: string | null;
          role?: "admin" | "employee";
          status?: "active" | "inactive";
          is_super_admin?: boolean;
          admin_scoped?: boolean;
          reset_token_hash?: string | null;
          reset_token_expires?: string | null;
          email_confirmed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          full_name?: string | null;
          role?: "admin" | "employee";
          status?: "active" | "inactive";
          is_super_admin?: boolean;
          admin_scoped?: boolean;
          reset_token_hash?: string | null;
          reset_token_expires?: string | null;
          email_confirmed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      employees: {
        Row: {
          id: string;
          display_name: string | null;
          position: string | null;
          shift_type: string | null;
          // Shift details
          shift_start: string | null;
          shift_end: string | null;
          // Company/Location
          company_name: string | null;
          work_location: string | null;
          // Personal details
          date_of_birth: string | null;
          phone_number: string | null;
          // Full address
          street_address: string | null;
          city: string | null;
          state: string | null;
          zip_code: string | null;
          country: string | null;
          // ID Documents
          id_document_type: IdDocumentType | null;
          id_document_number: string | null;
          id_document_expiry: string | null;
          id_document_url: string | null;
          // Profile picture
          profile_picture_url: string | null;
          // HR fields
          is_active: boolean;
          emergency_contact_name: string | null;
          emergency_contact_phone: string | null;
          hr_notes: string | null;
          // Device registration
          registered_device_id: string | null;
          device_registered_at: string | null;
          device_name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          position?: string | null;
          shift_type?: string | null;
          shift_start?: string | null;
          shift_end?: string | null;
          company_name?: string | null;
          work_location?: string | null;
          date_of_birth?: string | null;
          phone_number?: string | null;
          street_address?: string | null;
          city?: string | null;
          state?: string | null;
          zip_code?: string | null;
          country?: string | null;
          id_document_type?: IdDocumentType | null;
          id_document_number?: string | null;
          id_document_expiry?: string | null;
          id_document_url?: string | null;
          profile_picture_url?: string | null;
          is_active?: boolean;
          emergency_contact_name?: string | null;
          emergency_contact_phone?: string | null;
          hr_notes?: string | null;
          registered_device_id?: string | null;
          device_registered_at?: string | null;
          device_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string | null;
          position?: string | null;
          shift_type?: string | null;
          shift_start?: string | null;
          shift_end?: string | null;
          company_name?: string | null;
          work_location?: string | null;
          date_of_birth?: string | null;
          phone_number?: string | null;
          street_address?: string | null;
          city?: string | null;
          state?: string | null;
          zip_code?: string | null;
          country?: string | null;
          id_document_type?: IdDocumentType | null;
          id_document_number?: string | null;
          id_document_expiry?: string | null;
          id_document_url?: string | null;
          profile_picture_url?: string | null;
          is_active?: boolean;
          emergency_contact_name?: string | null;
          emergency_contact_phone?: string | null;
          hr_notes?: string | null;
          registered_device_id?: string | null;
          device_registered_at?: string | null;
          device_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      attendance_logs: {
        Row: {
          id: string;
          employee_id: string;
          clock_in: string;
          clock_out: string | null;
          total_hours: number | null;
          late_flag: boolean;
          early_checkout_flag: boolean;
          // Device tracking
          clock_in_device_id: string | null;
          clock_in_device_name: string | null;
          clock_out_device_id: string | null;
          clock_out_device_name: string | null;
          // Location tracking (legacy)
          clock_in_lat: number | null;
          clock_in_lng: number | null;
          clock_in_accuracy: number | null;
          clock_in_location_status: string | null;
          clock_out_lat: number | null;
          clock_out_lng: number | null;
          clock_out_accuracy: number | null;
          clock_out_location_status: string | null;
          // Resolved location names
          clock_in_location_name: string | null;
          clock_out_location_name: string | null;
          // Late clock-out tracking
          actual_clock_out: string | null;
          late_clock_out_minutes: number | null;
          // Other fields
          break_minutes: number | null;
          work_type: string | null;
          shift_timing: string | null;
          break_locations: Json[] | null;
          break_start: string | null;
          break_reminder_sent_at: string | null;
          edited_by_admin: boolean;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          clock_in: string;
          clock_out?: string | null;
          total_hours?: number | null;
          late_flag?: boolean;
          early_checkout_flag?: boolean;
          clock_in_device_id?: string | null;
          clock_in_device_name?: string | null;
          clock_out_device_id?: string | null;
          clock_out_device_name?: string | null;
          clock_in_lat?: number | null;
          clock_in_lng?: number | null;
          clock_in_accuracy?: number | null;
          clock_in_location_status?: string | null;
          clock_out_lat?: number | null;
          clock_out_lng?: number | null;
          clock_out_accuracy?: number | null;
          clock_out_location_status?: string | null;
          clock_in_location_name?: string | null;
          clock_out_location_name?: string | null;
          actual_clock_out?: string | null;
          late_clock_out_minutes?: number | null;
          break_minutes?: number | null;
          work_type?: string | null;
          shift_timing?: string | null;
          break_locations?: Json[] | null;
          break_start?: string | null;
          break_reminder_sent_at?: string | null;
          edited_by_admin?: boolean;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          employee_id?: string;
          clock_in?: string;
          clock_out?: string | null;
          total_hours?: number | null;
          late_flag?: boolean;
          early_checkout_flag?: boolean;
          clock_in_device_id?: string | null;
          clock_in_device_name?: string | null;
          clock_out_device_id?: string | null;
          clock_out_device_name?: string | null;
          clock_in_lat?: number | null;
          clock_in_lng?: number | null;
          clock_in_accuracy?: number | null;
          clock_in_location_status?: string | null;
          clock_out_lat?: number | null;
          clock_out_lng?: number | null;
          clock_out_accuracy?: number | null;
          clock_out_location_status?: string | null;
          clock_in_location_name?: string | null;
          clock_out_location_name?: string | null;
          actual_clock_out?: string | null;
          late_clock_out_minutes?: number | null;
          break_minutes?: number | null;
          work_type?: string | null;
          shift_timing?: string | null;
          break_locations?: Json[] | null;
          break_start?: string | null;
          break_reminder_sent_at?: string | null;
          edited_by_admin?: boolean;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      tasks: {
        Row: {
          id: string;
          title: string;
          description: string | null;
          is_recurring: boolean;
          frequency: string | null;
          location: string | null;
          role_target: string | null;
          cutoff_time: string | null;
          requires_photo: boolean;
          requires_video: boolean;
          requires_notes: boolean;
          reference_images: string[] | null;
          reference_videos: string[] | null;
          assigned_employee_ids: string[] | null;
          recurrence_days: string[] | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          description?: string | null;
          is_recurring?: boolean;
          frequency?: string | null;
          location?: string | null;
          role_target?: string | null;
          cutoff_time?: string | null;
          requires_photo?: boolean;
          requires_video?: boolean;
          requires_notes?: boolean;
          reference_images?: string[] | null;
          reference_videos?: string[] | null;
          assigned_employee_ids?: string[] | null;
          recurrence_days?: string[] | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          description?: string | null;
          is_recurring?: boolean;
          frequency?: string | null;
          location?: string | null;
          role_target?: string | null;
          cutoff_time?: string | null;
          requires_photo?: boolean;
          requires_video?: boolean;
          requires_notes?: boolean;
          reference_images?: string[] | null;
          reference_videos?: string[] | null;
          assigned_employee_ids?: string[] | null;
          recurrence_days?: string[] | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      task_instances: {
        Row: {
          id: string;
          task_id: string;
          employee_id: string;
          scheduled_date: string;
          status: "pending" | "completed" | "overdue";
          completed_at: string | null;
          notes: string | null;
          photo_url: string | null;
          photo_urls: string[] | null;
          video_url: string | null;
          video_urls: string[] | null;
          media_deleted_at: string | null;
          media_deleted_by: string | null;
          media_deleted_by_name: string | null;
          reminder_sent_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          employee_id: string;
          scheduled_date: string;
          status?: "pending" | "completed" | "overdue";
          completed_at?: string | null;
          notes?: string | null;
          photo_url?: string | null;
          photo_urls?: string[] | null;
          video_url?: string | null;
          video_urls?: string[] | null;
          media_deleted_at?: string | null;
          media_deleted_by?: string | null;
          media_deleted_by_name?: string | null;
          reminder_sent_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          task_id?: string;
          employee_id?: string;
          scheduled_date?: string;
          status?: "pending" | "completed" | "overdue";
          completed_at?: string | null;
          notes?: string | null;
          photo_url?: string | null;
          photo_urls?: string[] | null;
          video_url?: string | null;
          video_urls?: string[] | null;
          media_deleted_at?: string | null;
          media_deleted_by?: string | null;
          media_deleted_by_name?: string | null;
          reminder_sent_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      events: {
        Row: {
          id: string;
          title: string;
          start_time: string;
          end_time: string;
          room: string | null;
          expected_headcount: number | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          start_time: string;
          end_time: string;
          room?: string | null;
          expected_headcount?: number | null;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          start_time?: string;
          end_time?: string;
          room?: string | null;
          expected_headcount?: number | null;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      event_staff_assignments: {
        Row: {
          id: string;
          event_id: string;
          employee_id: string;
          role: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          employee_id: string;
          role?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          employee_id?: string;
          role?: string | null;
          created_at?: string;
        };
      };
      event_checklists: {
        Row: {
          id: string;
          event_id: string;
          task_title: string;
          status: "pending" | "completed";
          completed_by: string | null;
          completed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          task_title: string;
          status?: "pending" | "completed";
          completed_by?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          task_title?: string;
          status?: "pending" | "completed";
          completed_by?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
      };
      transactions: {
        Row: {
          id: string;
          event_id: string | null;
          customer_name: string | null;
          phone: string | null;
          amount: number;
          payment_method: string | null;
          created_at: string;
          handled_by_employee: string;
        };
        Insert: {
          id?: string;
          event_id?: string | null;
          customer_name?: string | null;
          phone?: string | null;
          amount: number;
          payment_method?: string | null;
          created_at?: string;
          handled_by_employee: string;
        };
        Update: {
          id?: string;
          event_id?: string | null;
          customer_name?: string | null;
          phone?: string | null;
          amount?: number;
          payment_method?: string | null;
          created_at?: string;
          handled_by_employee?: string;
        };
      };
      staff_notes: {
        Row: {
          id: string;
          event_id: string | null;
          employee_id: string;
          note: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id?: string | null;
          employee_id: string;
          note: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string | null;
          employee_id?: string;
          note?: string;
          created_at?: string;
        };
      };
      policy_strips: {
        Row: {
          id: string;
          title: string;
          content: string;
          category: string | null;
          is_active: boolean;
          image_url: string | null;
          video_url: string | null;
          media_type: MediaType | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          content: string;
          category?: string | null;
          is_active?: boolean;
          image_url?: string | null;
          video_url?: string | null;
          media_type?: MediaType | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          content?: string;
          category?: string | null;
          is_active?: boolean;
          image_url?: string | null;
          video_url?: string | null;
          media_type?: MediaType | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      schedules: {
        Row: {
          id: string;
          employee_id: string;
          schedule_date: string;
          start_time: string;
          end_time: string;
          title: string | null;
          description: string | null;
          location: string | null;
          status: ScheduleStatus;
          created_by: string;
          confirmed_at: string | null;
          cancellation_requested_at: string | null;
          cancellation_reason: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          confirmation_email_sent: boolean | null;
          cancellation_email_sent: boolean | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          schedule_date: string;
          start_time: string;
          end_time: string;
          title?: string | null;
          description?: string | null;
          location?: string | null;
          status?: ScheduleStatus;
          created_by: string;
          confirmed_at?: string | null;
          cancellation_requested_at?: string | null;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          confirmation_email_sent?: boolean | null;
          cancellation_email_sent?: boolean | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          employee_id?: string;
          schedule_date?: string;
          start_time?: string;
          end_time?: string;
          title?: string | null;
          description?: string | null;
          location?: string | null;
          status?: ScheduleStatus;
          created_by?: string;
          confirmed_at?: string | null;
          cancellation_requested_at?: string | null;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          confirmation_email_sent?: boolean | null;
          cancellation_email_sent?: boolean | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      schedule_email_logs: {
        Row: {
          id: string;
          schedule_id: string;
          email_type: ScheduleEmailType;
          recipient_email: string;
          recipient_type: 'employee' | 'manager' | 'owner';
          sent_at: string;
          status: 'sent' | 'failed';
          error_message: string | null;
        };
        Insert: {
          id?: string;
          schedule_id: string;
          email_type: ScheduleEmailType;
          recipient_email: string;
          recipient_type: 'employee' | 'manager' | 'owner';
          sent_at?: string;
          status?: 'sent' | 'failed';
          error_message?: string | null;
        };
        Update: {
          id?: string;
          schedule_id?: string;
          email_type?: ScheduleEmailType;
          recipient_email?: string;
          recipient_type?: 'employee' | 'manager' | 'owner';
          sent_at?: string;
          status?: 'sent' | 'failed';
          error_message?: string | null;
        };
      };
      notification_recipients: {
        Row: {
          id: string;
          email: string;
          name: string | null;
          recipient_type: RecipientType;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          name?: string | null;
          recipient_type: RecipientType;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          name?: string | null;
          recipient_type?: RecipientType;
          is_active?: boolean;
          created_at?: string;
        };
      };
      activity_logs: {
        Row: {
          id: string;
          admin_id: string | null;
          admin_email: string | null;
          action: string;
          entity_type: string;
          entity_id: string | null;
          entity_name: string | null;
          details: Json | null;
          ip_address: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          admin_id?: string | null;
          admin_email?: string | null;
          action: string;
          entity_type: string;
          entity_id?: string | null;
          entity_name?: string | null;
          details?: Json | null;
          ip_address?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          admin_id?: string | null;
          admin_email?: string | null;
          action?: string;
          entity_type?: string;
          entity_id?: string | null;
          entity_name?: string | null;
          details?: Json | null;
          ip_address?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
      };
      usage_logs: {
        Row: {
          id: string;
          user_id: string | null;
          user_email: string | null;
          user_role: string | null;
          event_type: string;
          event_category: string;
          event_action: string;
          event_label: string | null;
          page_path: string | null;
          page_title: string | null;
          metadata: Json | null;
          session_id: string | null;
          ip_address: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          user_email?: string | null;
          user_role?: string | null;
          event_type: string;
          event_category: string;
          event_action: string;
          event_label?: string | null;
          page_path?: string | null;
          page_title?: string | null;
          metadata?: Json | null;
          session_id?: string | null;
          ip_address?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          user_email?: string | null;
          user_role?: string | null;
          event_type?: string;
          event_category?: string;
          event_action?: string;
          event_label?: string | null;
          page_path?: string | null;
          page_title?: string | null;
          metadata?: Json | null;
          session_id?: string | null;
          ip_address?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
      };
      upload_logs: {
        Row: {
          id: string;
          user_id: string | null;
          user_email: string | null;
          user_role: string | null;
          status: string;
          bucket: string | null;
          file_name: string | null;
          file_size: number | null;
          mime_type: string | null;
          file_path: string | null;
          upload_context: string | null;
          entity_id: string | null;
          error_message: string | null;
          error_code: string | null;
          user_agent: string | null;
          device_name: string | null;
          ip_address: string | null;
          duration_ms: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          user_email?: string | null;
          user_role?: string | null;
          status: string;
          bucket?: string | null;
          file_name?: string | null;
          file_size?: number | null;
          mime_type?: string | null;
          file_path?: string | null;
          upload_context?: string | null;
          entity_id?: string | null;
          error_message?: string | null;
          error_code?: string | null;
          user_agent?: string | null;
          device_name?: string | null;
          ip_address?: string | null;
          duration_ms?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          user_email?: string | null;
          user_role?: string | null;
          status?: string;
          bucket?: string | null;
          file_name?: string | null;
          file_size?: number | null;
          mime_type?: string | null;
          file_path?: string | null;
          upload_context?: string | null;
          entity_id?: string | null;
          error_message?: string | null;
          error_code?: string | null;
          user_agent?: string | null;
          device_name?: string | null;
          ip_address?: string | null;
          duration_ms?: number | null;
          created_at?: string;
        };
      };
      businesses: {
        Row: {
          id: number;
          name: string;
          location: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          name: string;
          location?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          name?: string;
          location?: string | null;
          created_at?: string;
        };
      };
      employee_businesses: {
        Row: {
          employee_id: string;
          business_id: number;
        };
        Insert: {
          employee_id: string;
          business_id: number;
        };
        Update: {
          employee_id?: string;
          business_id?: number;
        };
      };
      admin_businesses: {
        Row: {
          id: number;
          admin_id: string;
          business_id: number;
          created_at: string;
        };
        Insert: {
          id?: number;
          admin_id: string;
          business_id: number;
          created_at?: string;
        };
        Update: {
          id?: number;
          admin_id?: string;
          business_id?: number;
          created_at?: string;
        };
      };
      org_nodes: {
        Row: {
          id: string;
          parent_id: string | null;
          node_type: "person" | "role" | "brand" | "location";
          name: string;
          subtitle: string | null;
          business_id: number | null;
          photo_url: string | null;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          parent_id?: string | null;
          node_type: "person" | "role" | "brand" | "location";
          name: string;
          subtitle?: string | null;
          business_id?: number | null;
          photo_url?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          parent_id?: string | null;
          node_type?: "person" | "role" | "brand" | "location";
          name?: string;
          subtitle?: string | null;
          business_id?: number | null;
          photo_url?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          type: string;
          title: string;
          body: string | null;
          link: string | null;
          is_read: boolean;
          dedupe_key: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: string;
          title: string;
          body?: string | null;
          link?: string | null;
          is_read?: boolean;
          dedupe_key?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          type?: string;
          title?: string;
          body?: string | null;
          link?: string | null;
          is_read?: boolean;
          dedupe_key?: string | null;
          created_at?: string;
        };
      };
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent: string | null;
          created_at: string;
          updated_at: string;
          last_success_at: string | null;
          last_error: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent?: string | null;
          created_at?: string;
          updated_at?: string;
          last_success_at?: string | null;
          last_error?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          endpoint?: string;
          p256dh?: string;
          auth?: string;
          user_agent?: string | null;
          created_at?: string;
          updated_at?: string;
          last_success_at?: string | null;
          last_error?: string | null;
        };
      };
      calendar_connections: {
        Row: {
          id: string;
          user_id: string;
          provider: "google" | "microsoft";
          provider_account_id: string | null;
          provider_account_email: string | null;
          access_token_enc: string | null;
          refresh_token_enc: string | null;
          token_expires_at: string | null;
          scopes: string | null;
          target_calendar_id: string | null;
          target_calendar_name: string;
          sync_token: string | null;
          watch_channel_id: string | null;
          watch_resource_id: string | null;
          watch_secret: string | null;
          watch_expires_at: string | null;
          status: "active" | "needs_reauth" | "revoked" | "error";
          last_synced_at: string | null;
          last_error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          provider: "google" | "microsoft";
          provider_account_id?: string | null;
          provider_account_email?: string | null;
          access_token_enc?: string | null;
          refresh_token_enc?: string | null;
          token_expires_at?: string | null;
          scopes?: string | null;
          target_calendar_id?: string | null;
          target_calendar_name?: string;
          sync_token?: string | null;
          watch_channel_id?: string | null;
          watch_resource_id?: string | null;
          watch_secret?: string | null;
          watch_expires_at?: string | null;
          status?: "active" | "needs_reauth" | "revoked" | "error";
          last_synced_at?: string | null;
          last_error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          provider_account_id: string | null;
          provider_account_email: string | null;
          access_token_enc: string | null;
          refresh_token_enc: string | null;
          token_expires_at: string | null;
          scopes: string | null;
          target_calendar_id: string | null;
          target_calendar_name: string;
          sync_token: string | null;
          watch_channel_id: string | null;
          watch_resource_id: string | null;
          watch_secret: string | null;
          watch_expires_at: string | null;
          status: "active" | "needs_reauth" | "revoked" | "error";
          last_synced_at: string | null;
          last_error: string | null;
          updated_at: string;
        }>;
      };
      calendar_sync_prefs: {
        Row: {
          user_id: string;
          sync_shifts: boolean;
          sync_tasks: boolean;
          sync_events: boolean;
          sync_birthdays: boolean;
          sync_onboarding: boolean;
          share_external_with_admin: boolean;
          share_external_details: boolean;
          reminder_minutes: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          sync_shifts?: boolean;
          sync_tasks?: boolean;
          sync_events?: boolean;
          sync_birthdays?: boolean;
          sync_onboarding?: boolean;
          share_external_with_admin?: boolean;
          share_external_details?: boolean;
          reminder_minutes?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          sync_shifts: boolean;
          sync_tasks: boolean;
          sync_events: boolean;
          sync_birthdays: boolean;
          sync_onboarding: boolean;
          share_external_with_admin: boolean;
          share_external_details: boolean;
          reminder_minutes: number;
          updated_at: string;
        }>;
      };
      calendar_event_links: {
        Row: {
          id: string;
          connection_id: string;
          user_id: string;
          source_type: "schedule" | "task" | "event" | "birthday" | "onboarding";
          source_id: string;
          external_event_id: string;
          content_hash: string | null;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          connection_id: string;
          user_id: string;
          source_type: "schedule" | "task" | "event" | "birthday" | "onboarding";
          source_id: string;
          external_event_id: string;
          content_hash?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          external_event_id: string;
          content_hash: string | null;
          deleted_at: string | null;
          updated_at: string;
        }>;
      };
      calendar_external_events: {
        Row: {
          id: string;
          connection_id: string;
          user_id: string;
          provider: string;
          external_id: string;
          calendar_id: string | null;
          title: string | null;
          description: string | null;
          location: string | null;
          starts_at: string | null;
          ends_at: string | null;
          all_day: boolean;
          transparency: string | null;
          status: string | null;
          organizer_email: string | null;
          html_link: string | null;
          is_playfunia: boolean;
          updated_at: string;
        };
        Insert: {
          id?: string;
          connection_id: string;
          user_id: string;
          provider: string;
          external_id: string;
          calendar_id?: string | null;
          title?: string | null;
          description?: string | null;
          location?: string | null;
          starts_at?: string | null;
          ends_at?: string | null;
          all_day?: boolean;
          transparency?: string | null;
          status?: string | null;
          organizer_email?: string | null;
          html_link?: string | null;
          is_playfunia?: boolean;
          updated_at?: string;
        };
        Update: Partial<{
          title: string | null;
          description: string | null;
          location: string | null;
          starts_at: string | null;
          ends_at: string | null;
          all_day: boolean;
          transparency: string | null;
          status: string | null;
          is_playfunia: boolean;
          updated_at: string;
        }>;
      };
      calendar_feed_tokens: {
        Row: {
          id: string;
          user_id: string;
          token_hash: string;
          label: string | null;
          last_used_at: string | null;
          revoked_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          token_hash: string;
          label?: string | null;
          last_used_at?: string | null;
          revoked_at?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          label: string | null;
          last_used_at: string | null;
          revoked_at: string | null;
        }>;
      };
      calendar_change_requests: {
        Row: {
          id: string;
          user_id: string;
          connection_id: string | null;
          source_type: string;
          source_id: string;
          kind: "cancel" | "reschedule";
          requested_start: string | null;
          requested_end: string | null;
          note: string | null;
          status: "pending" | "approved" | "rejected" | "superseded";
          resolved_at: string | null;
          resolved_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          connection_id?: string | null;
          source_type: string;
          source_id: string;
          kind: "cancel" | "reschedule";
          requested_start?: string | null;
          requested_end?: string | null;
          note?: string | null;
          status?: "pending" | "approved" | "rejected" | "superseded";
          resolved_at?: string | null;
          resolved_by?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          status: "pending" | "approved" | "rejected" | "superseded";
          resolved_at: string | null;
          resolved_by: string | null;
        }>;
      };
    };
    Views: {
      employee_recent_transactions: {
        Row: {
          id: string;
          event_id: string | null;
          customer_name: string | null;
          phone: string | null;
          amount: number;
          payment_method: string | null;
          created_at: string;
          handled_by_employee: string;
        };
      };
    };
    Functions: {
      clock_in: {
        Args: Record<string, never>;
        Returns: string;
      };
      clock_out: {
        Args: Record<string, never>;
        Returns: string;
      };
      get_open_attendance: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          clock_in: string;
        }[];
      };
      get_today_tasks: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          task_id: string;
          title: string;
          description: string | null;
          location: string | null;
          status: string;
          scheduled_date: string;
          cutoff_time: string | null;
          requires_photo: boolean;
          requires_video: boolean;
          requires_notes: boolean;
        }[];
      };
      get_my_upcoming_events: {
        Args: { p_limit: number };
        Returns: {
          id: string;
          title: string;
          start_time: string;
          end_time: string;
          room: string | null;
          expected_headcount: number | null;
          notes: string | null;
          my_role: string | null;
        }[];
      };
      get_admin_dashboard_stats: {
        Args: Record<string, never>;
        Returns: {
          active_employees: number;
          clocked_in_today: number;
          tasks_completed_today: number;
          tasks_pending_today: number;
          events_today: number;
          events_this_week: number;
          schedules_pending_confirmation: number;
          schedules_cancellation_requested: number;
        }[];
      };
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      complete_task: {
        Args: {
          p_task_instance_id: string;
          p_notes?: string;
          p_photo_url?: string;
          p_video_url?: string;
        };
        Returns: boolean;
      };
      confirm_schedule: {
        Args: { p_schedule_id: string };
        Returns: boolean;
      };
      request_schedule_cancellation: {
        Args: { p_schedule_id: string; p_reason: string };
        Returns: boolean;
      };
      approve_schedule_cancellation: {
        Args: { p_schedule_id: string };
        Returns: boolean;
      };
      admin_cancel_schedule: {
        Args: { p_schedule_id: string; p_reason?: string };
        Returns: boolean;
      };
      get_my_schedules: {
        Args: { p_start_date?: string; p_end_date?: string };
        Returns: {
          id: string;
          schedule_date: string;
          start_time: string;
          end_time: string;
          title: string | null;
          description: string | null;
          location: string | null;
          status: string;
          confirmed_at: string | null;
          cancellation_reason: string | null;
        }[];
      };
      get_employee_shift_info: {
        Args: Record<string, never>;
        Returns: {
          shift_type: string | null;
          shift_start: string | null;
          shift_end: string | null;
          company_name: string | null;
          work_location: string | null;
        }[];
      };
      register_device: {
        Args: { p_device_id: string; p_device_name?: string };
        Returns: boolean;
      };
      check_device: {
        Args: { p_device_id: string };
        Returns: {
          is_registered: boolean;
          registered_device_id: string | null;
          device_name: string | null;
        }[];
      };
      admin_clear_device: {
        Args: { p_employee_id: string };
        Returns: boolean;
      };
      get_employee_dashboard_data: {
        Args: { p_user_id: string };
        Returns: Json;
      };
      get_admin_schedules_page_data: {
        Args: { p_start_date?: string; p_end_date?: string; p_status?: string };
        Returns: Json;
      };
      get_schedule_stats: {
        Args: Record<string, never>;
        Returns: Json;
      };
      cleanup_old_task_media: {
        Args: Record<string, never>;
        Returns: number;
      };
    };
    Enums: {
      [_ in never]: never;
    };
  };
};

// Helper types
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type Insertable<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type Updatable<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
export type Views<T extends keyof Database["public"]["Views"]> =
  Database["public"]["Views"][T]["Row"];

// Convenience types
export type Profile = Tables<"profiles">;
export type Employee = Tables<"employees">;
export type AttendanceLog = Tables<"attendance_logs">;
export type Task = Tables<"tasks">;
export type TaskInstance = Tables<"task_instances">;
export type Event = Tables<"events">;
export type EventStaffAssignment = Tables<"event_staff_assignments">;
export type EventChecklist = Tables<"event_checklists">;
export type Transaction = Tables<"transactions">;
export type StaffNote = Tables<"staff_notes">;
export type PolicyStrip = Tables<"policy_strips">;
export type Schedule = Tables<"schedules">;
export type ScheduleEmailLog = Tables<"schedule_email_logs">;
export type NotificationRecipient = Tables<"notification_recipients">;
export type ActivityLog = Tables<"activity_logs">;
export type UsageLog = Tables<"usage_logs">;
export type UploadLog = Tables<"upload_logs">;
export type Business = Tables<"businesses">;
export type EmployeeBusiness = Tables<"employee_businesses">;
export type OrgNode = Tables<"org_nodes">;

// Extended types with relations
export type EmployeeWithProfile = Employee & {
  profile?: Profile;
};

export type ScheduleWithEmployee = Schedule & {
  employee?: EmployeeWithProfile;
};
