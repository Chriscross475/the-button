import { defineReveal } from '../levels/scaffold';
import { revealLoadingScreen } from '../levels/loading-screen';

// The loading screen: stuck at 99% in a grey void. Push the bar to 100% yourself.

export const loadingScreen = defineReveal('loading-screen', 1.1, revealLoadingScreen);
