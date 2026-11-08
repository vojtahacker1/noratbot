const WORDS = ['minecraft','redstone','creeper','diamond','nether','enderman','command','parkour','spleef','village','pickaxe','crafting'];
const games = new WeakMap();
function render(g) { return `${g.mask.split('').join(' ')}\nWrong guesses: ${g.wrong.join(', ') || '(none)'}\nGuesses left: ${g.left}`; }
module.exports = {
 name:'hangman', description:'Play Hangman; submit one letter with hangman <letter>, or check status', aliases:['hm'], level:0,
 async execute(ctx) {
  const [guess]=ctx.args||[], say=ctx.tellrawCommand.bind(ctx), bot=ctx.bot;
  let g=games.get(bot);
  if(guess && /^\d+$/.test(guess)) return say('Guess limit is fixed at 6.');
  if(!g){const word=WORDS[Math.floor(Math.random()*WORDS.length)];g={word,mask:'_'.repeat(word.length),wrong:[],left:6};games.set(bot,g);}
  if(!guess)return say(`Hangman started. Guess with hangman <letter>.\n${render(g)}`);
  const letter=guess.toLowerCase();if(!/^[a-z]$/.test(letter))return say('Guess one letter: hangman <a-z>.');
  if(g.mask.includes(letter)||g.wrong.includes(letter))return say(`Already guessed ${letter}.\n${render(g)}`);
  if(g.word.includes(letter))g.mask=[...g.word].map((c,i)=>c===letter?letter:g.mask[i]).join('');else{g.wrong.push(letter);g.left--;}
  if(!g.mask.includes('_')){games.delete(bot);return say(`You win! The word was ${g.word}.`);}
  if(g.left<=0){games.delete(bot);return say(`Game over — the word was ${g.word}.`);}
  say(render(g));
 }
};
