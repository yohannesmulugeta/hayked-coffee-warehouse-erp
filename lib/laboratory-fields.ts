export const coffeeCategories = ["Washed", "Natural", "UG"] as const;

export function laboratoryGrades(category: string): string[] {
  return category === "UG" ? ["UG"] : category === "Washed" || category === "Natural"
    ? ["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5"] : [];
}

export function validLaboratoryGrade(category: string, grade: string): boolean {
  return laboratoryGrades(category).includes(grade);
}
