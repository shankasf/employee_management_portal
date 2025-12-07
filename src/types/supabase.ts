export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

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
      waivers: {
        Row: {
          id: string;
          phone: string | null;
          customer_name: string | null;
          signed_at: string | null;
          waiver_url: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          phone?: string | null;
          customer_name?: string | null;
          signed_at?: string | null;
          waiver_url?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          phone?: string | null;
          customer_name?: string | null;
          signed_at?: string | null;
          waiver_url?: string | null;
          notes?: string | null;
          created_at?: string;
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
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          content: string;
          category?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          content?: string;
          category?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
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
        }[];
      };
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      search_waivers_by_phone: {
        Args: { p_phone: string };
        Returns: {
          id: string;
          phone: string | null;
          customer_name: string | null;
          signed_at: string | null;
          waiver_url: string | null;
        }[];
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
