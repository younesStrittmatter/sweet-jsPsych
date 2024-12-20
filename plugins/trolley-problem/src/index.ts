import { JsPsych, JsPsychPlugin, ParameterType, TrialType } from "jspsych";
import { createTrolleyProblem } from "figure-lab";


const info = <const>{
  name: "trolley-problem",
  version: '0.0.5',
  parameters: {
    /** */
    main_track: {
      type: ParameterType.STRING,
      default: [
        { gender: "male", body_type: "business", skin: "white" }
      ]
    },
    /** */
    side_track: {
      type: ParameterType.STRING,
      default: [
        { gender: "male", body_type: "business", skin: "white" }
      ]
    },
    /** */
    choices: {
      type: ParameterType.KEYS,
      default: "ALL_KEYS"
    },
    /** */
    trial_duration: {
      type: ParameterType.INT,
      default: null
    },
    /** */
    show_prompt: {
      type: ParameterType.BOOL,
      default: true
    }
  },
  data: {
    /** Provide a clear description of the data1 that could be used as documentation. We will eventually use these comments to automatically build documentation and produce metadata. */
    action: {
      type: ParameterType.STRING
    },
    /** */
    choice: {
      type: ParameterType.STRING
    },
    /** The response time in milliseconds for the participant to make a response. The time is measured from when the stimulus first appears on the screen until the participant's response. */
    rt: {
      type: ParameterType.INT
    },
    /** The HTML content that was displayed on the screen. */
    main_track: {
      type: ParameterType.COMPLEX
    },
    side_track: {
      type: ParameterType.COMPLEX
    }
  }
};

type Info = typeof info;

/**
 * **{name}**
 *
 * {description}
 *
 * @author {author}
 * @see {@link {documentation-url}}}
 */
class TrolleyProblemPlugin implements JsPsychPlugin<Info> {
  static info = info;

  constructor(private jsPsych: JsPsych) {
  }

  trial(display_element: HTMLElement, trial: TrialType<Info>) {
    const style = document.createElement("style");

// Add CSS rules
    style.innerHTML = `
    * {
    margin: 0;
    padding: 0;
    font-family: Arial, sans-serif;
    }
    h1 {
    position: fixed;
    top: 1vh;
    left: 0;
    width: 100%;
    text-align: center;
    line-height: 8vh;
    font-size: 6vh;
    }
    
    #main-track {
    position: fixed;
    border-radius: 10px;
    top: 10%;
    height: 60%;
    width: 40%;
    right: 55%;
    }
    #main-track:hover {
    cursor: pointer;
    box-shadow: 0 0 10px 5px #f008;
    }
    #side-track {
    position: fixed;
    border-radius: 10px;
    top: 10%;
    height: 60%;
    width: 40%;
    left: 55%;
    }
    #side-track:hover {
    cursor: pointer;
    box-shadow: 0 0 10px 5px #f008;
    }
    #prompt {
    position: fixed;
    top: 72%;
    width: 80%;
    left: 10%;
    text-align: center;
    font-size: 2vh;
    }
    
`;

// Append the <style> element to the <head>
    document.head.appendChild(style);

    let response = {
        rt: null,
        action: null,
        choice: null
      };
    
    (async () => {

      const trollProb = await createTrolleyProblem(trial.main_track, trial.side_track);
      trollProb.forEach((svg) => {
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");
      });


      const trollProbMain = trollProb[1];
      const trollProbSide = trollProb[2];

      const mainTrack = document.createElement("div");
      mainTrack.id = "main-track";
      mainTrack.appendChild(trollProbMain);
      display_element.appendChild(mainTrack);
      mainTrack.onclick = () => {
        after_response({ action: "nothing", choice: "main" ,rt: performance.now() });
      }

      const sideTrack = document.createElement("div");
      sideTrack.id = "side-track";
      sideTrack.appendChild(trollProbSide);
      display_element.appendChild(sideTrack);
      sideTrack.onclick = () => {
        after_response({ action: "flip", choice: "side", rt: performance.now() });
      }


      const title = document.createElement("h1");
      title.innerHTML = "What do you do?";
      display_element.appendChild(title);


      const prompt = document.createElement("div");
      prompt.id = "prompt";

      const mainTrackText_1 = trial.main_track.length > 1 ?
        `are ${trial.main_track.length} people` :
        trial.main_track.length === 1 ?
          `is one person` :
          `is nobody`;

      const sideTrackText_1 = trial.side_track.length > 1 ?
        `are ${trial.side_track.length} people` :
        trial.side_track.length === 1 ?
          `is one person` :
          `is nobody`;

      const mainTrackText_2 = trial.main_track.length > 1 ?
        `the ${trial.main_track.length} people` :
        trial.main_track.length === 1 ?
          `the one person` :
          `nobody`;

      const sideTrackText_2 = trial.side_track.length > 1 ?
        `the ${trial.side_track.length} people` :
        trial.side_track.length === 1 ?
          `the one person` :
          `nobody`;

      if (trial.show_prompt) {
        prompt.innerHTML = `You are standing by the railroad tracks when you notice an empty boxcar rolling out of control. It is moving so fast that anyone it hits will die. Ahead on the main track ${mainTrackText_1}. There ${sideTrackText_1} standing on a side track that doesn't rejoin the main track.  If you do nothing, the boxcar will hit ${mainTrackText_2} on the main track, but it will not hit ${sideTrackText_2} the side track. If you flip a switch next to you, it will divert the boxcar to the side track where it will hit ${sideTrackText_2}, and not hit ${mainTrackText_2} on the main track.<br>Click on the left picture to do nothing, or the right picture to flip the switch.`;
      } else {
        prompt.innerHTML = "Click on the left picture to do nothing, or the right picture to flip the switch.";
      }

      display_element.appendChild(prompt);







      // function to end trial when it is time
      const end_trial = () => {

        // gather the data to store for the trial
        const trial_data = {
          rt: response.rt,
          main_track: trial.main_track,
          side_track: trial.side_track,
          action: response.action,
          choice: response.choice
        };

        // move on to the next trial
        this.jsPsych.finishTrial(trial_data);
      };

      // function to handle responses by the subject
      const after_response = (info) => {
        if (response.action == null) {
          response = info;
        }
        end_trial();
      };




      if (trial.trial_duration !== null) {
        this.jsPsych.pluginAPI.setTimeout(end_trial, trial.trial_duration);
      }
    })();
  }

}

export default TrolleyProblemPlugin;
