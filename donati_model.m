%%% Model code by Morten Gram Pedersen, University of Padova, Italy for 
%%% Donati V, Peres C, ..., Bortolozzi M, Pedersen MG, Mammamo F: 
%%% Calcium signaling in the photodamaged skin: in vivo experiments and mathematical modeling
%%% FUNCTION, 2021

%% Parameters

D=65; 
k=0.27;  % ARL multiply by 0.5  ; apyrase multiply by 10
vSERCA=65; 
L=0.5; 
PIP3R = 42625; 
vplc=1.85; 
kplc=1.05; 
kip=15; 
kHC=1200; 
nplc=1;

vpmca = 0;
par = [D, k, vpmca, PIP3R, vSERCA, L, vplc, kplc, kip, kHC, nplc];

par = [D, k, vpmca, PIP3R, vSERCA, L, vplc, kplc, kip, kHC, nplc];

%% Initial conditions
a_IC=zeros(20,1);
ac_IC=800; 
a0_IC=0;
ip3_IC=zeros(20,1);
ca_IC=0.068+zeros(20,1);
h_IC = 0.85+zeros(20,1);
CaB_IC =2.375+zeros(20,1);
fb_IC = zeros(20,1);
Y0=[a_IC; ac_IC; a0_IC; ip3_IC; ca_IC; h_IC; CaB_IC; fb_IC];

%% calculate solution
    
options = odeset('AbsTol',1e-8,'RelTol',1e-6,'MaxStep',1);

tspan=[-1000:0.1:3000];
[T Y]=ode15s(@ATP_model,tspan,Y0,options,par);

idx = find((T >= -1 & T <= 60) | mod(round(T*10),10) == 0);
writematrix([T(idx) Y(idx,:)], 'donati_ref.csv');

a = Y(:,1:20);
ac = Y(:,21);
a0 = Y(:,22);
ip3 = Y(:,23:42);
ca = Y(:,43:62);
h = Y(:,63:82);

dF_sim0 = Y(:,83:102) - Y(1000,83:102); %normalize to [0 1]
dF_sim = dF_sim0/max(max(dF_sim0(T<30,:)));


%%
figure(1)

subplot(2,2,1)
plot(T,dF_sim(:,1:8),'-','LineWidth',2)
set(gca,'ColorOrderIndex',1)
axis([-1 30 -0.1 1.1])
ylabel('Normalized dF/F0', 'FontSize', 12)
xlabel('time [sec]',  'FontSize', 12)
tt=title('C');
tt.FontSize=18;
tt.Units = 'Normalize'; 
tt.Position(1) = 0;
tt.HorizontalAlignment ='left';

subplot(2,2,2)
set(gca,'ColorOrderIndex',1)
plot(T/60,dF_sim(:,1:8),'-','LineWidth',2)
axis([-1 20 -0.1 1.1])
legend('10 Âµm', '20 Âµm', '30 Âµm', '40 Âµm', '50 Âµm', ...
    '60 Âµm', '70 Âµm', '80 Âµm');
ylabel('Normalized dF/F0', 'FontSize', 12)
xlabel('time [min]', 'FontSize', 12)
tt=title('D');
tt.FontSize=18;
tt.Units = 'Normalize'; 
tt.Position(1) = 0;
tt.HorizontalAlignment ='left';

% calculate front
TTT=T(T>0);

front =zeros(length(TTT),1);

dF_pos= dF_sim(T>0,:);

for i=8:1:length(front)
    front(i)=interp1(dF_pos(i,1:8),10:10:80,0.3,'linear');
end
subplot(2,2,3)
plot([0; TTT(8:1:length(front))],[0; front(8:1:end)],'k','LineWidth',2)

axis([0 30 0 100])
ylabel('Radial distance [\mum ]', 'FontSize', 12)
xlabel('time [sec]', 'FontSize', 12)
tt=title('E');
tt.FontSize=18;
tt.Units = 'Normalize'; 
tt.Position(1) = 0;
tt.HorizontalAlignment ='left';
hold off

subplot(2,2,4)
plot([0; TTT(8:1:end)]/60,[0; front(8:1:end)],'k','LineWidth',2)
ylabel('Radial distance [\mum ]',  'FontSize', 12)
xlabel('time [min]', 'FontSize', 12)
axis([0 20 0 100])
tt=title('F');
tt.FontSize=18;
tt.Units = 'Normalize'; 
tt.Position(1) = 0;
tt.HorizontalAlignment ='left';


%% ATP, IP3, Ca2+ ctrl
figure(2)

subplot(3,1,1)
set(gca,'ColorOrderIndex',1)
plot(T/60,a(:,1:8),'-','LineWidth',2)
axis([-1 20 0 250])
ylabel('ATP [\muM]', 'FontSize', 12)
xlabel('time [min]', 'FontSize', 12)
tt=title('A');
tt.FontSize=18;
tt.Units = 'Normalize'; 
tt.Position(1) = 0;
tt.HorizontalAlignment ='left';
legend('10 Âµm', '20 Âµm', '30 Âµm', '40 Âµm', '50 Âµm', ...
    '60 Âµm', '70 Âµm', '80 Âµm');

subplot(3,1,2)
plot(T,a(:,1:8),'-','LineWidth',2)
axis([-1 30 0 250])
set(gca,'ColorOrderIndex',1)
ylabel('ATP [\muM]', 'FontSize', 12)
xlabel('time [sec]',  'FontSize', 12)
tt=title('B');
tt.FontSize=18;
tt.Units = 'Normalize'; 
tt.Position(1) = 0;
tt.HorizontalAlignment ='left';

subplot(3,1,3)
set(gca,'ColorOrderIndex',1)
plot(T,ip3(:,1:8),'-','LineWidth',2)
axis([-1 30 0. 0.15])
ylabel('IP3 [\muM]', 'FontSize', 12)
xlabel('time [sec]', 'FontSize', 12)
tt=title('C');
tt.FontSize=18;
tt.Units = 'Normalize'; 
tt.Position(1) = 0;
tt.HorizontalAlignment ='left';

%% The model equations to be solved
function dY=ATP_model(t,Y,par)

D=par(1)*heaviside(t);
k=par(2);  
vPMCA=par(3);
PIP3R=par(4); 
ka=100;

vSERCA=par(5);
L=par(6);
 
vplc=par(7);
kplc=par(8);
nplc=par(11);
kip=par(9);

% Hemichannels
kHC=par(10)*heaviside(t);

% Li-Rinzel
Ki=1; Ka=0.4; A=5; Kd=0.4; 

% SERCA, PMCA
kSERCA=0.2;

CaT=2;          % total Calcium in cell
sigma=0.1;      % cytosolic-to-ER volumes
fi=0.02;        % free-to-bound Ca

% geometry
deltar=10;
deltah=0.02;

% gCAMP
kon=7.78; koff=1.12; Btot=7.4;

% rename variables
a=Y(1:20);
a(21)=a(20);
ac=Y(21);
a0=Y(22);

ip3=Y(23:42);
ca=Y(43:62);
caER =(CaT-ca)/sigma ;
h=Y(63:82);
CaB=Y(83:102);
psi = Y(103:122);

% feedback of Ca2+ on PLC
caplcpar=0.6;
ncaplc =1;
ca_on_plc = caplcpar*ca.^ncaplc./(ca.^ncaplc+0.3^ncaplc);

% Ca2+ fluxes
jchan= PIP3R.*(ip3./(ip3+Ki)).^3.*(ca./(ca+Ka)).^3.*h.^3.*(caER-ca) ;
jpump=(vSERCA*ca.^2)./(kSERCA.^2+ca.^2) ; 
jleak=L*(caER-ca) ;

% ODEs

dac = - D/(deltah*deltar)*(ac-a0) ;
da0 = 4*D/deltar.^2*(a(1)-a0) + D/(deltah.^2)*(ac-a0) - k*a0; 

da=zeros(20,1);
da(1) = (D/(2*1*deltar^2)) * ((2*1+1)*a(1+1)-4*1*a(1)+(2*1-1)*a0)-k*a(1)... 
                +kHC*ca(1).^8/(ca(1).^8+0.3^8);
for j=2:20 
da(j) = (D/(2*j*deltar^2)) * ((2*j+1)*a(j+1)-4*j*a(j)+(2*j-1)*a(j-1))-k*a(j)... 
                +kHC*ca(j).^8/(ca(j).^8+0.3^8);
end
dpsi = (ca_on_plc-psi)/30;
avec=a(1:20); 
dip3 = (1+psi).*vplc.*avec.^nplc./(avec.^nplc+kplc.^nplc) - kip*ip3 ; 
buff = kon*ca.*(Btot-CaB) - koff*CaB;
dca = (jchan-jpump+jleak ) - 3*buff;
dh = A*(Kd - (ca+Kd).*h) ;
dCaB = buff; 

dY=[da; dac; da0; dip3; dca; dh; dCaB; dpsi];
end