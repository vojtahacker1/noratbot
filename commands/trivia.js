const QUESTIONS = [
 ['What dimension contains the Ender Dragon?', 'the end'],
 ['Which ore drops diamonds when mined without Silk Touch?', 'diamond ore'],
 ['What item activates a Nether portal?', 'flint and steel'],
 ['What mob explodes near players?', 'creeper'],
 ['What is the name of the default player character?', 'steve']
];
const rounds = new WeakMap();
module.exports = {
 name:'trivia', description:'Minecraft trivia; trivia answer <text> or trivia skip', aliases:['quiz'], level:0,
 async execute(ctx) {
  const [action,...parts]=ctx.args||[], say=ctx.tellrawCommand.bind(ctx), bot=ctx.bot;
  let round=rounds.get(bot);
  if(action==='skip'){if(!round)return say('No trivia question is active.');rounds.delete(bot);return say(`Answer: ${round.answer}. Start another with trivia.`);}
  if(action==='answer'){
   if(!round)return say('No question is active. Start one with trivia.');
   const answer=parts.join(' ').trim().toLowerCase();if(!answer)return say('Usage: trivia answer <answer>');
   if(answer===round.answer){rounds.delete(bot);return say(`${ctx.player?.name||'Player'} got it! ${round.question}`);}
   return say('Not quite—try again or use trivia skip.');
  }
  if(round)return say(`Question: ${round.question} (answer with trivia answer <text>)`);
  const [question,answer]=QUESTIONS[Math.floor(Math.random()*QUESTIONS.length)];rounds.set(bot,{question,answer});say(`Trivia: ${question} Answer with trivia answer <text>.`);
 }
};
