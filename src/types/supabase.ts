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
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          full_name?: string | null;
          role?: "admin" | "employee";
          status?: "active" | "inactive";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          full_name?: string | null;
          role?: "admin" | "employee";
          status?: "active" | "inactive";
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
          // HR fields
          is_active: boolean;
          emergency_contact_name: string | null;
          emergency_contact_phone: string | null;
          hr_notes: string | null;
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
          is_active?: boolean;
          emergency_contact_name?: string | null;
          emergency_contact_phone?: string | null;
          hr_notes?: string | null;
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
          is_active?: boolean;
          emergency_contact_name?: string | null;
          emergency_contact_phone?: string | null;
          hr_notes?: string | null;
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
          video_url: string | null;
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
          video_url?: string | null;
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
          video_url?: string | null;
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
          confirmation_email_sent: boolean;
          cancellation_email_sent: boolean;
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
          confirmation_email_sent?: boolean;
          cancellation_email_sent?: boolean;
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
          confirmation_email_sent?: boolean;
          cancellation_email_sent?: boolean;
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

// Extended types with relations
export type EmployeeWithProfile = Employee & {
  profile?: Profile;
};

export type ScheduleWithEmployee = Schedule & {
  employee?: EmployeeWithProfile;
};
