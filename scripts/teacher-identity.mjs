// Only trusted administrative code sets users.teacherIds. A display name is
// insufficient: account owners can edit it. Institutional email must match.
export const normalizeTeacherName=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function teacherIdsForEmail(email,teachers){
  const match=/^([^@]+)@uni-pr[.]edu$/i.exec(email||'');
  if(!match)return [];
  const matches=Object.entries(teachers).filter(([,name])=>normalizeTeacherName(name)===normalizeTeacherName(match[1]));
  return matches.length===1?[matches[0][0]]:[];
}
