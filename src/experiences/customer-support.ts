import { defineReveal } from '../levels/scaffold';
import { revealCustomerSupport } from '../levels/customer-support';

// Customer support: an office, a desk phone, and an automated menu that goes
// nowhere. Zero — never mentioned — puts you on hold for a human. It's him.

export const customerSupport = defineReveal('customer-support', 1.1, revealCustomerSupport);
