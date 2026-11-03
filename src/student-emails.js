export function parseStudentEmails(value) {
  const emails=value.trim().split(/[\s,;:]+/).filter(Boolean).map(email=>email.toLowerCase());
  if(emails.length>100)throw Error('Lejohen deri në 100 emaila studentësh për rezervim.');
  if(emails.some(email=>! /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@student\.uni-pr\.edu$/.test(email)||email.split('@')[0].length>64))throw Error('Çdo email duhet të jetë i vlefshëm dhe të përfundojë me @student.uni-pr.edu.');
  return [...new Set(emails)];
}
