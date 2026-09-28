export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      academic_terms: {
        Row: {
          campus_id: string;
          created_at: string;
          ends_on: string;
          id: string;
          name: string;
          starts_on: string;
        };
        Insert: {
          campus_id: string;
          created_at?: string;
          ends_on: string;
          id?: string;
          name: string;
          starts_on: string;
        };
        Update: {
          campus_id?: string;
          created_at?: string;
          ends_on?: string;
          id?: string;
          name?: string;
          starts_on?: string;
        };
        Relationships: [
          {
            foreignKeyName: "academic_terms_campus_id_fkey";
            columns: ["campus_id"];
            isOneToOne: false;
            referencedRelation: "campuses";
            referencedColumns: ["id"];
          },
        ];
      };
      campuses: {
        Row: {
          created_at: string;
          id: string;
          name: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
      classes: {
        Row: {
          archived_at: string | null;
          campus_id: string;
          created_at: string;
          grade: string | null;
          id: string;
          name: string;
          subject: string | null;
          teacher_id: string | null;
        };
        Insert: {
          archived_at?: string | null;
          campus_id: string;
          created_at?: string;
          grade?: string | null;
          id?: string;
          name: string;
          subject?: string | null;
          teacher_id?: string | null;
        };
        Update: {
          archived_at?: string | null;
          campus_id?: string;
          created_at?: string;
          grade?: string | null;
          id?: string;
          name?: string;
          subject?: string | null;
          teacher_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "classes_campus_id_fkey";
            columns: ["campus_id"];
            isOneToOne: false;
            referencedRelation: "campuses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "classes_teacher_id_fkey";
            columns: ["teacher_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      documents: {
        Row: {
          class_id: string;
          file_name: string;
          id: string;
          mime_type: string | null;
          parse_error: string | null;
          parse_status: Database["public"]["Enums"]["parse_status"];
          parsed_text: string | null;
          recording_id: string | null;
          scope: Database["public"]["Enums"]["document_scope"];
          size_bytes: number | null;
          storage_path: string;
          superseded_at: string | null;
          type: Database["public"]["Enums"]["document_type"];
          uploaded_at: string;
          uploaded_by: string | null;
        };
        Insert: {
          class_id: string;
          file_name: string;
          id?: string;
          mime_type?: string | null;
          parse_error?: string | null;
          parse_status?: Database["public"]["Enums"]["parse_status"];
          parsed_text?: string | null;
          recording_id?: string | null;
          scope?: Database["public"]["Enums"]["document_scope"];
          size_bytes?: number | null;
          storage_path: string;
          superseded_at?: string | null;
          type: Database["public"]["Enums"]["document_type"];
          uploaded_at?: string;
          uploaded_by?: string | null;
        };
        Update: {
          class_id?: string;
          file_name?: string;
          id?: string;
          mime_type?: string | null;
          parse_error?: string | null;
          parse_status?: Database["public"]["Enums"]["parse_status"];
          parsed_text?: string | null;
          recording_id?: string | null;
          scope?: Database["public"]["Enums"]["document_scope"];
          size_bytes?: number | null;
          storage_path?: string;
          superseded_at?: string | null;
          type?: Database["public"]["Enums"]["document_type"];
          uploaded_at?: string;
          uploaded_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "documents_class_id_fkey";
            columns: ["class_id"];
            isOneToOne: false;
            referencedRelation: "classes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_recording_id_fkey";
            columns: ["recording_id"];
            isOneToOne: false;
            referencedRelation: "recordings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      model_runs: {
        Row: {
          class_id: string | null;
          created_at: string;
          error: string | null;
          id: string;
          input_refs: NonNullable<Json>;
          latency_ms: number | null;
          model: string;
          output: Json | null;
          prompt_version: string | null;
          provider: string;
          purpose: string;
          recording_id: string | null;
          usage: Json | null;
        };
        Insert: {
          class_id?: string | null;
          created_at?: string;
          error?: string | null;
          id?: string;
          input_refs?: NonNullable<Json>;
          latency_ms?: number | null;
          model: string;
          output?: Json | null;
          prompt_version?: string | null;
          provider: string;
          purpose: string;
          recording_id?: string | null;
          usage?: Json | null;
        };
        Update: {
          class_id?: string | null;
          created_at?: string;
          error?: string | null;
          id?: string;
          input_refs?: NonNullable<Json>;
          latency_ms?: number | null;
          model?: string;
          output?: Json | null;
          prompt_version?: string | null;
          provider?: string;
          purpose?: string;
          recording_id?: string | null;
          usage?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "model_runs_class_id_fkey";
            columns: ["class_id"];
            isOneToOne: false;
            referencedRelation: "classes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "model_runs_recording_id_fkey";
            columns: ["recording_id"];
            isOneToOne: false;
            referencedRelation: "recordings";
            referencedColumns: ["id"];
          },
        ];
      };
      processing_jobs: {
        Row: {
          attempt_count: number;
          class_id: string | null;
          created_at: string;
          document_id: string | null;
          error_detail: string | null;
          finished_at: string | null;
          id: string;
          max_attempts: number;
          recording_id: string | null;
          stage: Database["public"]["Enums"]["job_stage"];
          started_at: string | null;
          status: Database["public"]["Enums"]["job_status"];
          updated_at: string;
        };
        Insert: {
          attempt_count?: number;
          class_id?: string | null;
          created_at?: string;
          document_id?: string | null;
          error_detail?: string | null;
          finished_at?: string | null;
          id?: string;
          max_attempts?: number;
          recording_id?: string | null;
          stage: Database["public"]["Enums"]["job_stage"];
          started_at?: string | null;
          status?: Database["public"]["Enums"]["job_status"];
          updated_at?: string;
        };
        Update: {
          attempt_count?: number;
          class_id?: string | null;
          created_at?: string;
          document_id?: string | null;
          error_detail?: string | null;
          finished_at?: string | null;
          id?: string;
          max_attempts?: number;
          recording_id?: string | null;
          stage?: Database["public"]["Enums"]["job_stage"];
          started_at?: string | null;
          status?: Database["public"]["Enums"]["job_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "processing_jobs_class_id_fkey";
            columns: ["class_id"];
            isOneToOne: false;
            referencedRelation: "classes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "processing_jobs_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "processing_jobs_recording_id_fkey";
            columns: ["recording_id"];
            isOneToOne: false;
            referencedRelation: "recordings";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          campus_id: string;
          created_at: string;
          deactivated_at: string | null;
          email: string;
          full_name: string;
          id: string;
          invited_by: string | null;
          role: Database["public"]["Enums"]["app_role"];
        };
        Insert: {
          campus_id: string;
          created_at?: string;
          deactivated_at?: string | null;
          email: string;
          full_name?: string;
          id: string;
          invited_by?: string | null;
          role: Database["public"]["Enums"]["app_role"];
        };
        Update: {
          campus_id?: string;
          created_at?: string;
          deactivated_at?: string | null;
          email?: string;
          full_name?: string;
          id?: string;
          invited_by?: string | null;
          role?: Database["public"]["Enums"]["app_role"];
        };
        Relationships: [
          {
            foreignKeyName: "profiles_campus_id_fkey";
            columns: ["campus_id"];
            isOneToOne: false;
            referencedRelation: "campuses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profiles_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      recordings: {
        Row: {
          campus_id: string;
          class_id: string;
          created_at: string;
          duration_sec: number | null;
          ended_at: string | null;
          error_detail: string | null;
          id: string;
          mime_type: string | null;
          original_path: string | null;
          possible_duplicate_of: string | null;
          recorded_at: string;
          semester_expiry_date: string | null;
          size_bytes: number | null;
          source: Database["public"]["Enums"]["recording_source"];
          status: Database["public"]["Enums"]["recording_status"];
          teacher_id: string;
          term_id: string | null;
          updated_at: string;
          video_deleted_at: string | null;
          video_path: string | null;
        };
        Insert: {
          campus_id: string;
          class_id: string;
          created_at?: string;
          duration_sec?: number | null;
          ended_at?: string | null;
          error_detail?: string | null;
          id?: string;
          mime_type?: string | null;
          original_path?: string | null;
          possible_duplicate_of?: string | null;
          recorded_at?: string;
          semester_expiry_date?: string | null;
          size_bytes?: number | null;
          source: Database["public"]["Enums"]["recording_source"];
          status?: Database["public"]["Enums"]["recording_status"];
          teacher_id: string;
          term_id?: string | null;
          updated_at?: string;
          video_deleted_at?: string | null;
          video_path?: string | null;
        };
        Update: {
          campus_id?: string;
          class_id?: string;
          created_at?: string;
          duration_sec?: number | null;
          ended_at?: string | null;
          error_detail?: string | null;
          id?: string;
          mime_type?: string | null;
          original_path?: string | null;
          possible_duplicate_of?: string | null;
          recorded_at?: string;
          semester_expiry_date?: string | null;
          size_bytes?: number | null;
          source?: Database["public"]["Enums"]["recording_source"];
          status?: Database["public"]["Enums"]["recording_status"];
          teacher_id?: string;
          term_id?: string | null;
          updated_at?: string;
          video_deleted_at?: string | null;
          video_path?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "recordings_campus_id_fkey";
            columns: ["campus_id"];
            isOneToOne: false;
            referencedRelation: "campuses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recordings_class_id_fkey";
            columns: ["class_id"];
            isOneToOne: false;
            referencedRelation: "classes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recordings_possible_duplicate_of_fkey";
            columns: ["possible_duplicate_of"];
            isOneToOne: false;
            referencedRelation: "recordings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recordings_teacher_id_fkey";
            columns: ["teacher_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recordings_term_id_fkey";
            columns: ["term_id"];
            isOneToOne: false;
            referencedRelation: "academic_terms";
            referencedColumns: ["id"];
          },
        ];
      };
      report_edits: {
        Row: {
          edited_at: string;
          edited_by: string;
          id: string;
          new_content: Json | null;
          previous_content: Json | null;
          report_id: string;
          section_key: string | null;
          version: number;
        };
        Insert: {
          edited_at?: string;
          edited_by: string;
          id?: string;
          new_content?: Json | null;
          previous_content?: Json | null;
          report_id: string;
          section_key?: string | null;
          version: number;
        };
        Update: {
          edited_at?: string;
          edited_by?: string;
          id?: string;
          new_content?: Json | null;
          previous_content?: Json | null;
          report_id?: string;
          section_key?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "report_edits_edited_by_fkey";
            columns: ["edited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "report_edits_report_id_fkey";
            columns: ["report_id"];
            isOneToOne: false;
            referencedRelation: "reports";
            referencedColumns: ["id"];
          },
        ];
      };
      report_templates: {
        Row: {
          created_at: string;
          definition: NonNullable<Json>;
          id: string;
          is_active: boolean;
          name: string;
          version: number;
        };
        Insert: {
          created_at?: string;
          definition: NonNullable<Json>;
          id?: string;
          is_active?: boolean;
          name: string;
          version: number;
        };
        Update: {
          created_at?: string;
          definition?: NonNullable<Json>;
          id?: string;
          is_active?: boolean;
          name?: string;
          version?: number;
        };
        Relationships: [];
      };
      reports: {
        Row: {
          created_at: string;
          current_version: number;
          finalized_at: string | null;
          finalized_by: string | null;
          id: string;
          model_run_id: string | null;
          recording_id: string;
          rubric_id: string | null;
          sections: NonNullable<Json>;
          status: Database["public"]["Enums"]["report_status"];
          template_id: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          current_version?: number;
          finalized_at?: string | null;
          finalized_by?: string | null;
          id?: string;
          model_run_id?: string | null;
          recording_id: string;
          rubric_id?: string | null;
          sections?: NonNullable<Json>;
          status?: Database["public"]["Enums"]["report_status"];
          template_id?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          current_version?: number;
          finalized_at?: string | null;
          finalized_by?: string | null;
          id?: string;
          model_run_id?: string | null;
          recording_id?: string;
          rubric_id?: string | null;
          sections?: NonNullable<Json>;
          status?: Database["public"]["Enums"]["report_status"];
          template_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reports_finalized_by_fkey";
            columns: ["finalized_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reports_model_run_id_fkey";
            columns: ["model_run_id"];
            isOneToOne: false;
            referencedRelation: "model_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reports_recording_id_fkey";
            columns: ["recording_id"];
            isOneToOne: true;
            referencedRelation: "recordings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reports_rubric_id_fkey";
            columns: ["rubric_id"];
            isOneToOne: false;
            referencedRelation: "rubrics";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reports_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "report_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      rubrics: {
        Row: {
          class_id: string;
          created_at: string;
          derived_from_document_ids: string[];
          error_detail: string | null;
          id: string;
          model_run_id: string | null;
          status: Database["public"]["Enums"]["rubric_status"];
          structured_criteria: Json | null;
          version: number;
        };
        Insert: {
          class_id: string;
          created_at?: string;
          derived_from_document_ids?: string[];
          error_detail?: string | null;
          id?: string;
          model_run_id?: string | null;
          status?: Database["public"]["Enums"]["rubric_status"];
          structured_criteria?: Json | null;
          version: number;
        };
        Update: {
          class_id?: string;
          created_at?: string;
          derived_from_document_ids?: string[];
          error_detail?: string | null;
          id?: string;
          model_run_id?: string | null;
          status?: Database["public"]["Enums"]["rubric_status"];
          structured_criteria?: Json | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "rubrics_class_id_fkey";
            columns: ["class_id"];
            isOneToOne: false;
            referencedRelation: "classes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rubrics_model_run_id_fkey";
            columns: ["model_run_id"];
            isOneToOne: false;
            referencedRelation: "model_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      transcripts: {
        Row: {
          created_at: string;
          full_text: string;
          id: string;
          model_run_ids: string[];
          recording_id: string;
          segments: NonNullable<Json>;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          full_text?: string;
          id?: string;
          model_run_ids?: string[];
          recording_id: string;
          segments?: NonNullable<Json>;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          full_text?: string;
          id?: string;
          model_run_ids?: string[];
          recording_id?: string;
          segments?: NonNullable<Json>;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "transcripts_recording_id_fkey";
            columns: ["recording_id"];
            isOneToOne: true;
            referencedRelation: "recordings";
            referencedColumns: ["id"];
          },
        ];
      };
      video_analyses: {
        Row: {
          created_at: string;
          findings: NonNullable<Json>;
          id: string;
          model_run_id: string | null;
          recording_id: string;
          summary: Json | null;
        };
        Insert: {
          created_at?: string;
          findings?: NonNullable<Json>;
          id?: string;
          model_run_id?: string | null;
          recording_id: string;
          summary?: Json | null;
        };
        Update: {
          created_at?: string;
          findings?: NonNullable<Json>;
          id?: string;
          model_run_id?: string | null;
          recording_id?: string;
          summary?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "video_analyses_model_run_id_fkey";
            columns: ["model_run_id"];
            isOneToOne: false;
            referencedRelation: "model_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "video_analyses_recording_id_fkey";
            columns: ["recording_id"];
            isOneToOne: true;
            referencedRelation: "recordings";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      admin_of_class: { Args: { p_class_id: string }; Returns: boolean };
      admin_of_recording: { Args: { p_recording_id: string }; Returns: boolean };
      current_campus_id: { Args: Record<PropertyKey, never>; Returns: string };
      current_role_name: {
        Args: Record<PropertyKey, never>;
        Returns: Database["public"]["Enums"]["app_role"];
      };
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      owns_recording: { Args: { p_recording_id: string }; Returns: boolean };
      owns_recording_path: { Args: { p_recording_id: string }; Returns: boolean };
      teaches_class: { Args: { p_class_id: string }; Returns: boolean };
    };
    Enums: {
      app_role: "teacher" | "admin";
      document_scope: "class" | "recording";
      document_type: "planner" | "learning_outcomes" | "kpis" | "tors" | "other";
      job_stage:
        | "upload"
        | "normalization"
        | "transcription"
        | "video_analysis"
        | "report_generation"
        | "document_parse"
        | "rubric_derivation";
      job_status: "pending" | "processing" | "complete" | "failed";
      parse_status: "pending" | "processing" | "complete" | "failed";
      recording_source: "in_app" | "upload";
      recording_status: "recording" | "uploading" | "processing" | "ready" | "failed";
      report_status: "draft" | "final";
      rubric_status: "pending" | "ready" | "failed";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["teacher", "admin"],
      document_scope: ["class", "recording"],
      document_type: ["planner", "learning_outcomes", "kpis", "tors", "other"],
      job_stage: [
        "upload",
        "normalization",
        "transcription",
        "video_analysis",
        "report_generation",
        "document_parse",
        "rubric_derivation",
      ],
      job_status: ["pending", "processing", "complete", "failed"],
      parse_status: ["pending", "processing", "complete", "failed"],
      recording_source: ["in_app", "upload"],
      recording_status: ["recording", "uploading", "processing", "ready", "failed"],
      report_status: ["draft", "final"],
      rubric_status: ["pending", "ready", "failed"],
    },
  },
} as const;
