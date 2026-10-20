// Validación de patentes, igual que `CarLicense` de la app oficial.

export const MAX_VEHICLES = 5; // la app oficial no deja agregar más

const CAR = /^[A-Z]{3}[0-9]{3}$|^[A-Z]{2}[0-9]{3}[A-Z]{2}$/; // ABC123, AB123CD
const MOTORBIKE = /^[0-9]{3}[A-Z]{3}$|^[A-Z][0-9]{3}[A-Z]{3}$/; // 123ABC, A123BCD

/** Mayúsculas y sin espacios ni guiones. */
export function normalizePlate(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

export function isValidPlate(plate: string): boolean {
  return CAR.test(plate) || MOTORBIKE.test(plate);
}
