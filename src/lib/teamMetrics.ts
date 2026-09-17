import { normalizeRole, Role } from "../types";

export interface TeamRoleRecord {
  role?: Role | string;
}

export function getTeamRoleCounts(team: TeamRoleRecord[]) {
  return {
    totalTeam: team.length,
    medicalReps: team.filter((member) => normalizeRole(member.role) === Role.MEDICAL_REP).length,
    salesReps: team.filter((member) => normalizeRole(member.role) === Role.SALES_REP).length,
  };
}
