import { PlayerInput } from '../shared/types.js';

export class InputHandler {
  private keys: Set<string> = new Set();
  
  constructor() {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.key.toLowerCase());
      // Prevent space from scrolling
      if (e.key === ' ') e.preventDefault();
    });
    
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
    });
    
    // Clear keys when window loses focus
    window.addEventListener('blur', () => {
      this.keys.clear();
    });
  }
  
  getInput(): PlayerInput {
    return {
      left: this.keys.has('a') || this.keys.has('arrowleft'),
      right: this.keys.has('d') || this.keys.has('arrowright'),
      jump: this.keys.has('w') || this.keys.has(' ') || this.keys.has('arrowup'),
      attack1: this.keys.has('j'),
      attack2: this.keys.has('k'),
      block: this.keys.has('l'),
    };
  }
}

