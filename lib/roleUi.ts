export const ROLES_LIST_HREF = "/admin/users?tab=roles";

export type RoleFormValues = {
  name: string;
  colorClass: string;
};

export function defaultRoleFormValues(): RoleFormValues {
  return {
    name: "",
    colorClass: "hex:#475569",
  };
}
