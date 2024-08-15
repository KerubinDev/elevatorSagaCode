{
    init: function(elevators, floors) {
        // Determina automaticamente qual algoritmo usar com base no número do desafio.
        var throughputChallenges = [ 1, 2, 3, 4, 5 ];
        var saveMovesChallenges = [ 6, 7 ];

        var path = document.URL.substr(document.URL.lastIndexOf("#"));
        var params = _.reduce(path.split(","), function(result, part) {
            var match = part.match(/(\w+)=(\w+$)/);

            if (match) {
                result[match[1]] = match[2];
            }

            return result;
        }, {});
        var challenge = ~~params.challenge;
        var improveThroughput = throughputChallenges.indexOf(challenge) != -1;
        var saveMoves = saveMovesChallenges.indexOf(challenge) != -1;

        // Fila para andares onde as pessoas esperam, na ordem em que os botões foram pressionados pela primeira vez
        floors.waitQueue = [];
        // Esta função adiciona um andar à fila de espera se o andar ainda não estiver lá
        floors.addToWaitQueue = function(floorNum) {
            if (floors.waitQueue.indexOf(floorNum) === -1) {
                floors.waitQueue.push(floorNum);
            }
        };
        floors.removeFromWaitQueue = function(floorNum) {
            var index = floors.waitQueue.indexOf(floorNum);

            if (index !== -1) {
                floors.waitQueue.splice(index, 1);
            }
        };

        // Esta função é chamada sempre que algo acontece, caso algum elevador que estava inativo agora tenha alguém para pegar em outro andar.
        var checkElevators = function() {
            elevators.forEach(function(elevator, elevatorNum) {
                elevator.checkIdle();
            });
        };

        // Configurar eventos dos andares
        floors.forEach(function(floor) {
            // Há pessoas esperando neste andar?
            floor.peopleWaiting = false;
            // Quais elevadores estão indo para este andar (usado para evitar que múltiplos elevadores peguem a mesma pessoa)
            floor.elevatorsGoing = Array.apply(null, new Array(elevators.length)).map(Number.prototype.valueOf, 0);
            floor.countCapacityOfElevatorsGoing = function() {
                return this.elevatorsGoing.reduce(function(capacitySum, going, elevatorNum) {
                    if (going) {
                        return capacitySum + elevators[elevatorNum].capacity() + elevators[elevatorNum].peopleGoingTo[floor.floorNum()];
                    } else {
                        return capacitySum;
                    }
                }, 0);
            };

            // Adiciona pessoas à fila de espera na ordem em que pressionam o botão.
            floor.on("up_button_pressed down_button_pressed", function() {
                floor.peopleWaiting = true;
                floors.addToWaitQueue(floor.floorNum());
                checkElevators();
            });
        });

        // Configurar eventos dos elevadores
        elevators.forEach(function(elevator, elevatorNum) {
            elevator.elevatorNum = elevatorNum;
            // Número de pessoas neste elevador indo para cada andar
            // Calculado a partir do número de vezes que o botão de cada andar foi pressionado
            elevator.peopleGoingTo = Array.apply(null, new Array(floors.length)).map(Number.prototype.valueOf, 0);
            // Fila para a ordem em que as pessoas entraram no elevador, para que possamos levá-las
            // aos seus destinos da forma mais justa possível
            elevator.peopleQueue = [[]];

            // A fila de destinos não é realmente usada nesta solução, nós apenas vamos de
            // inativo diretamente para o andar para o qual queremos ir e depois de volta para inativo.
            elevator.goToFloorAndClearQueue = function(floor) {
                this.destinationQueue = [ floor.floorNum() ];
                this.checkDestinationQueue();
                this.idle = false;

                // Assume que este elevador só parará no destino final.
                floors.forEach(function(floor) {
                    floor.elevatorsGoing[this.elevatorNum] = false;
                }.bind(this));

                // Garantir que outros não vão para o mesmo andar ao mesmo tempo.
                floor.elevatorsGoing[this.elevatorNum] = true;
            };

            // Isso é usado para resolver os níveis onde precisamos usar o menor número de movimentos possível.
            // Então, movemos apenas um andar por vez.
            elevator.goTowardsFloor = function(floor) {
                var floorDelta = 1;

                if (floor.floorNum() < this.currentFloor()) {
                    floorDelta = -1;
                }

                var destinationFloorNum = this.currentFloor() + floorDelta;

                this.goToFloorAndClearQueue(floors[destinationFloorNum]);
            };

            // Verifica a configuração.
            elevator.goToFloorOrTowards = function(floor) {
                if (floor.floorNum() === elevator.currentFloor()) {
                    return;
                }

                if (saveMoves) {
                    this.goTowardsFloor(floor);
                } else {
                    this.goToFloorAndClearQueue(floor);
                }
            };

            // Calcula quantas pessoas estão atualmente neste elevador.
            elevator.peopleIn = function() {
                return elevator.peopleGoingTo.reduce(function(sum, current) {
                    return sum + current;
                }, 0);
            };

            // Quantas pessoas ainda cabem no elevador.
            elevator.capacity = function() {
                return 4 - this.peopleIn();
            };

            // Se estamos inativos, tente pegar algumas pessoas ou deixar alguém.
            elevator.checkIdle = function() {
                if (!this.idle) {
                    return;
                }

                // Tente contornar o fato de que às vezes as pessoas entram no elevador e só pressionam o botão depois que ele começou a se mover, usando o fator de carga.
                // Se o fator de carga nos diz que há alguém dentro, mas eles ainda não pressionaram um botão, espere que eles pressionem antes de começarmos a nos mover.
                if (this.peopleIn() === 0 && this.loadFactor() > 0) {
                    return;
                }

                // Só pegar pessoas se tivermos espaço.
                if (this.peopleIn() === 0 && !saveMoves) {
                    for (var i = 0; i < floors.waitQueue.length; ++i) {
                        // Pegue na ordem em que os botões foram pressionados em cada andar.
                        var floor = floors[floors.waitQueue[i]];

                        if (floor.countCapacityOfElevatorsGoing() === 0) {
                            this.goToFloorOrTowards(floor);
                            return;
                        }
                    }
                }

                // Se estamos tentando usar o menor número de movimentos possível, só mova quando o elevador estiver cheio.
                var minimumPeopleInElevator = saveMoves ? 4 : 0;
                var thisElevator = this;

                // No modo de máxima justiça, sempre deixe a pessoa que entrou primeiro, ou a mais próxima caso muitas tenham entrado ao mesmo tempo
                if (!improveThroughput) {
                    var closestFloor = { floorNum: this.currentFloor(), delta: 999 };

                    // Leve as pessoas que estiveram no elevador por mais tempo para o seu destino primeiro.
                    var queue = this.peopleQueue[0];

                    // Se não houver ninguém no elevador, não faça nada.
                    if (queue.length === 0) {
                        return;
                    }

                    // Se muitas pessoas entraram no elevador ao mesmo tempo, deixe a que tem o andar de destino mais próximo da posição atual do elevador primeiro.
                    queue.forEach(function(floorNum) {
                        var delta = Math.abs(floorNum - thisElevator.currentFloor());

                        if (delta < closestFloor.delta && thisElevator.peopleIn() >= minimumPeopleInElevator) {
                            closestFloor = { floorNum: floorNum, delta: delta };
                        }
                    });

                    this.goToFloorOrTowards(floors[closestFloor.floorNum], true);
                } else {
                    // No modo de throughput, deixe o maior número possível de pessoas, no andar mais próximo entre os andares para os quais o mesmo número de pessoas quer ir
                    var bestFloor = { floorNum: this.currentFloor(), count: 0, delta: 999 };
                    thisElevator.peopleGoingTo.forEach(function(count, floorNum) {
                        var delta = Math.abs(floorNum - thisElevator.currentFloor());

                        if ((count > bestFloor.count || (count === bestFloor.count && delta < bestFloor.delta)) && thisElevator.peopleIn() >= minimumPeopleInElevator) {
                            bestFloor = { floorNum: floorNum, count: count };
                        }
                    });

                    this.goToFloorOrTowards(floors[bestFloor.floorNum], true);
                }
            };

            // Acabamos de parar, então verifique se há pessoas para pegar ou deixar.
            // Como não usamos a fila de comandos, isso acontece com bastante frequência.
            elevator.on("idle", function() {
                elevator.idle = true;
                elevator.checkIdle();
            });

            // As pessoas serão levadas aos seus destinos na ordem em que entram no elevador
            // (exceto quando várias pessoas entram no mesmo andar)
            elevator.on("floor_button_pressed", function(floorNum) {
                var currentQueue = elevator.peopleQueue[elevator.peopleQueue.length - 1];

                if (currentQueue.indexOf(floorNum) === -1) {
                    currentQueue.push(floorNum);
                }

                elevator.peopleGoingTo[floorNum] += 1;
                elevator.checkIdle();
            });

            elevator.on("stopped_at_floor", function(floorNum) {
                // Todos no elevador que estão indo para este andar já saíram
                // então limpe a fila de destinos das pessoas neste elevador
                elevator.peopleQueue = elevator.peopleQueue.map(function(queue) {
                    var index = queue.indexOf(floorNum);

                    if (index !== -1) {
                        queue.splice(index, 1);
                    }

                    return queue;
                });

                // Remove elementos vazios da fila
                elevator.peopleQueue = elevator.peopleQueue.filter(function(queue) {
                    return queue.length !== 0;
                });

                // Quando chegarmos ao próximo andar, agrupe as chegadas para que
                // possam ser assumidas como se tivessem entrado no elevador ao mesmo tempo
                elevator.peopleQueue.push([]);

                // Assume-se que todos conseguiram entrar no elevador
                // (se não, eles pressionarão o botão novamente e acabarão no final da fila)
                floors.removeFromWaitQueue(floorNum);
                floors[floorNum].peopleWaiting = false;
                // Permite que outros elevadores venham para este andar se houver mais pessoas para pegar
                floors[floorNum].elevatorsGoing[elevator.elevatorNum] = false;
                elevator.peopleGoingTo[floorNum] = 0;
            });
        });

        // Leva o primeiro e o último elevador ao topo quando o sistema começa a rodar
        elevators[0].goToFloorAndClearQueue(floors[floors.length - 1]);
        elevators[elevators.length - 1].goToFloorAndClearQueue(floors[floors.length - 1]);
    },

        update: function(dt, elevators, floors) {
            elevators.forEach(function(elevator) {
                if (elevator.idle) {
                    elevator.goToFloor(elevator.currentFloor(), true); // pegue qualquer um que esteja esperando
                }
            });
        }
}
