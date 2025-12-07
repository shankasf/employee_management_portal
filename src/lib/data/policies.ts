import { createClient, createUntypedClient } from "@/lib/supabase/client";
import { Insertable, Updatable } from "@/types/supabase";

// Get active policies (for employees)
export async function getActivePolicies() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("policy_strips")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}

// Get all policies (for admin)
export async function getAllPolicies() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("policy_strips")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}

// Get a single policy
export async function getPolicy(id: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("policy_strips")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

// Create a new policy
export async function createPolicy(policy: Insertable<"policy_strips">) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("policy_strips")
    .insert(policy)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Update a policy
export async function updatePolicy(
  id: string,
  updates: Updatable<"policy_strips">
) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("policy_strips")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Delete a policy
export async function deletePolicy(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from("policy_strips").delete().eq("id", id);

  if (error) throw error;
}

// Toggle policy active status
export async function togglePolicyStatus(id: string, isActive: boolean) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("policy_strips")
    .update({ is_active: isActive })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Get policy categories (unique)
export async function getPolicyCategories() {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("policy_strips")
    .select("category")
    .not("category", "is", null);

  if (error) throw error;

  // Get unique categories
  interface PolicyCategory {
    category: string | null;
  }
  const categories = Array.from(
    new Set(data?.map((p: PolicyCategory) => p.category).filter(Boolean))
  );
  return categories;
}
