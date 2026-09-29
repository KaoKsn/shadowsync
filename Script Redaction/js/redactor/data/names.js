/**
 * Name gazetteer (lowercase). Starter list focused on Indian names plus common
 * Western names; extend freely — larger lists improve recall on single first names.
 */
const words = (s) => s.trim().split(/\s+/);

export const FIRST_NAMES = new Set(words(`
aarav aarush aditya advait akash akshay amit amitabh anand anil ankit ankur anuj anupam arjun arnav arun arvind ashish
ashok atul ayush balaji bharat bhavesh chetan chirag deepak devendra dhruv dinesh gaurav girish gopal govind hari harish
harsh hemant ishaan jagdish jatin kabir kamal karan karthik kartik kishore krishna kunal lalit madhav mahesh manish manoj
mayank mohan mukesh murali nakul naresh naveen neeraj nikhil nilesh nitin pankaj paras parth pawan piyush pradeep
prakash pranav prashant pratik praveen prem rahul raj rajat rajesh rajeev rakesh ramesh ranjit ravi rishi ritesh rohan
rohit sachin sagar sahil sai sameer sandeep sanjay santosh sarthak satish saurabh shankar shekhar shiv shivam shreyas
shubham siddharth sonu subhash sudhir sumit sunil suraj suresh sushil tarun tushar uday umesh varun vijay vikas vikram
vinay vinod vipin vishal vivek yash yogesh abhishek abhinav ajay alok aman amol anirudh arpit ashwin ayaan dhananjay
gautam hrithik jayant kailash kiran lakshman mihir omkar prasad raghav raghu rajendra ranveer ritwik shantanu sriram
subramaniam sundar tejas vasant venkat venkatesh vignesh vinayak yuvraj srinivas srinivasan senthil murugan muthu
selvam sathya naga harsha manoj ganesh mahendra narendra surendra jitendra dharmendra upendra virendra rupesh
aadhya aishwarya akanksha aditi amrita ananya anjali ankita anushka anusha aparna archana arti asha bhavna chitra deepa
deepika divya diya garima gayatri geeta hema isha ishita jaya jyoti kajal kalpana kavita kavya khushi komal kriti
lakshmi lata madhu madhuri mamta manisha meena meera megha monika namrata nandini neha nidhi nikita nisha pallavi pooja
poonam prachi pragya preeti priya priyanka radha radhika rani rashmi rekha renu ritu riya rupa sakshi sangeeta sanjana
sapna sarita shalini shilpa shivani shobha shreya shruti simran sneha sonal sonia sudha suman sunita supriya swati tanvi
tanya uma usha vandana varsha vidya kiara zara saanvi myra anaya navya sarika sushma savita shweta smita sujata sunanda
tara trisha vaishali yamini bhavana charu harini janani keerthana lavanya mythili nithya padma revathi sangita sowmya
srividya vasudha ramya kalyani parvati sarojini indira kamala vimala nirmala leela
mohammed muhammad mohammad mohd ahmed ahmad ali abdul imran irfan farhan faisal salman shahid tariq zaid zain arif asif
aamir amir aslam javed kareem rashid rizwan sajid shoaib wasim yusuf ayesha aisha fatima zoya sana saira nazia rukhsar
shabana shaheen yasmin zainab mehreen heena nargis mustafa hassan hussain junaid adnan
gurpreet harpreet manpreet jaspreet harjeet gurmeet jaswinder balwinder sukhwinder amrit navjot parminder kuldeep
hardeep jasleen
thomas joseph george mathew matthew jacob john james paul peter mary anna elizabeth susan jose antony anthony
sebastian francis xavier stephen philip abraham tessa
robert michael william david richard charles christopher daniel donald steven andrew joshua kenneth kevin brian
timothy ronald edward jason jeffrey ryan gary nicholas eric jonathan larry justin scott brandon benjamin samuel gregory
alexander patrick raymond dennis jerry tyler aaron henry adam douglas nathan zachary kyle noah ethan jeremy walter
keith roger terry austin sean gerald carl harold dylan arthur lawrence jordan jesse bryan billy bruce gabriel logan
alan juan albert willie elijah wayne randy vincent mason ralph bobby russell bradley eugene
patricia jennifer linda barbara jessica sarah karen lisa nancy betty sandra margaret ashley kimberly emily donna
michelle amanda melissa deborah stephanie dorothy rebecca sharon laura cynthia amy kathleen angela shirley brenda emma
pamela nicole samantha katherine christine helen debra rachel carolyn janet maria catherine heather diane olivia julie
joyce victoria ruth virginia lauren kelly christina joan evelyn judith andrea hannah megan cheryl jacqueline martha
madison teresa gloria sara janice ann kathryn abigail sophia frances jean alice judy isabella julia amber denise
danielle marilyn beverly charlotte natalie theresa diana brittany doris kayla alexis lori
`));

export const SURNAMES = new Set(words(`
sharma verma gupta singh kumar patel shah mehta joshi desai iyer iyengar nair menon pillai reddy rao naidu chowdhury
choudhary chaudhary das dutta datta banerjee chatterjee mukherjee bose ghosh sen roy sinha mishra tiwari pandey dubey
dwivedi trivedi chaturvedi shukla srivastava saxena agarwal aggarwal agrawal bansal goyal goel jain kapoor khanna
malhotra arora bhatia chopra sethi ahuja kohli gill sandhu dhillon grewal sidhu bajwa brar randhawa khan qureshi sheikh
shaikh siddiqui ansari syed hussain rizvi mirza pathan patil kulkarni deshpande deshmukh pawar jadhav shinde gaikwad
naik kamath shetty hegde bhat pai gowda krishnan subramanian venkataraman raman swamy rajan murthy moorthy thakur
rathore rajput chauhan yadav prasad nath thakkar parekh modi amin bhatt vyas dave pandya solanki rana negi rawat bisht
mathew thomas joseph george varghese kurian abraham fernandes dsouza d'souza pereira rodrigues gomes lobo pinto
saldanha menezes dias kaur bhattacharya mazumdar majumdar sarkar biswas saha mondal mandal paul jha kumari devi lal
nayak mohanty patnaik panda sahu behera pradhan mahapatra baruah bora gogoi hazarika kalita sarma natarajan
ramachandran balasubramanian sundaram mani narayanan gopalan vasudevan chandran babu achari warrier namboodiri kutty
kurup panicker irani contractor wadia mistry bhosale salvi sawant kadam chavan mane rane
smith johnson williams brown jones garcia miller davis rodriguez martinez hernandez lopez gonzalez wilson anderson
taylor moore jackson martin lee perez thompson white harris sanchez clark ramirez lewis robinson walker young allen
king wright scott torres nguyen hill flores green adams nelson baker hall rivera campbell mitchell carter roberts gomez
phillips evans turner diaz parker cruz edwards collins reyes stewart morris morales murphy cook rogers gutierrez ortiz
morgan cooper peterson bailey reed howard ramos kim cox ward richardson watson brooks chavez wood bennett gray mendoza
ruiz hughes price alvarez castillo sanders myers ross foster jimenez
`));

/** Names that are also common English words: only count with a surname or an explicit cue. */
export const AMBIGUOUS = new Set(words(`
hope joy sunny may june april august grace faith rose lily daisy will bill mark art summer autumn dawn crystal ruby
pearl jade honey frank chance sky river rain angel star lucky ray guy gene carol penny bob rob pat sue don ken max rich
dev ram jack chase hunter drew grant miles wade page lane dale glen
`));

/** Capitalized words that mark an organization / place, never part of a person's name. */
export const NON_NAME = new Set(words(`
hospital hospitals clinic clinics bank traders trading ltd limited pvt private inc corp corporation company co llp llc
road street nagar apartments apartment university college school institute services solutions technologies tech
enterprises industries foundation trust society team department ministry government office hotel restaurant store
stores mart side menu center centre hall park temple church mosque station airport market mall group labs systems
insurance finance capital motors pharma pharmaceuticals healthcare medical care diagnostics agency associates
brothers sons & and of the for club academy court board council committee district state city
`));

/** Words that commonly start a sentence or label and are never names. */
export const COMMON_WORDS = new Set(words(`
the a an this that these those my your our their his her its we you they i he she it hi hello dear thanks thank please
regards best sincerely customer patient employee client user applicant beneficiary nominee contact emergency name
dr mr mrs ms shri smt sri kumari prof sir madam from to by for with and or but not
`));
