import { defineReveal } from '../levels/scaffold';
import { revealGiftShop } from '../levels/gift-shop';

// The gift shop: exit through it. The turnstile only turns for customers —
// pay (money, or a coin from the fountain) or shoplift past the guard.

export const giftShop = defineReveal('gift-shop', 1.1, revealGiftShop);
